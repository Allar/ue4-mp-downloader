// API for interfacing with Epic's 'deep' API
var epic_api = function () {};

const rimraf = require('rimraf');
const mkdirp = require('mkdirp');
const download = require('download-file');
const ProgressBar = require('progress');
const zlib = require('zlib');
const fs = require('fs');

var slowRequestPool = {maxSockets: 2};

global.marketplace = {};
global.marketplace_ajax = {};
global.marketplace_ownedAssets = {};
global.marketplace_ownedAssets_consolidated = {};

global.epic_oauth = (global.epic_oauth === undefined) ? undefined : global.epic_oauth;

global.fakeJar = (global.fakeJar === undefined) ? {} : global.fakeJar;
global.epic_Cookie = (global.epic_Cookie === undefined) ? undefined : global.epic_Cookie;
global.epic_Country = (global.epic_Country === undefined) ? undefined : global.epic_Country;
global.epic_SSO = (global.epic_SSO === undefined) ? undefined : global.epic_SSO;
global.epic_SSO_RM = (global.epic_SSO_RM === undefined) ? undefined : global.epic_SSO_RM;

// Grabs Epic's web login form
// Callback has string parameter containing login form html, i.e. function (form) ()
epic_api.prototype.GetWebLoginForm = function (cb_form) {
	var opts = {
		uri: 'https://accounts.unrealengine.com/login/doLogin',
	};
	
	request.get(opts, function (error, response, body) {
		global.epic_api.updateFakeJar(response.headers['set-cookie']);
		if (cb_form != undefined) {
			cb_form(body);
		}
	});
}

epic_api.prototype.updateFakeJar = function(set_cookie_array) {
	for (var i = 0; i < set_cookie_array.length; ++i) {
		var cookie_pair = set_cookie_array[i].split(';',1)[0].split('=');
		global.fakeJar[cookie_pair[0]] = cookie_pair[1];
		if(cookie_pair[1] == 'invalid') {
			delete global.fakeJar[cookie_pair[0]];
		}
	}
}

epic_api.prototype.GetWebCookieString = function () {
	var cookieString = "";
	for(var key in global.fakeJar) {
		cookieString += key + '=' + global.fakeJar[key] + '; ';
	}
	return cookieString;
}

epic_api.prototype.WebLogin = function(loginObject, cb_status) {
	var opts = {
		uri: 'https://accounts.unrealengine.com/login/doLogin',
		form: loginObject,
		headers: { Cookie: global.epic_api.GetWebCookieString(), Origin: 'allar_ue4_marketplace_commandline' },
		qs: { client_id: '43e2dea89b054198a703f6199bee6d5b' }
	};
   
	
	request.post(opts, function(error, response, body) {	
		if (response.statusCode == 400) // login failure
		{
			cb_status('Failed', false);
		} else if (response.statusCode == 302) // success
		{
			global.epic_api.updateFakeJar(response.headers['set-cookie']);
			if (cb_status != undefined) {
				cb_status('Authorizing Web Login...', false);
			}
			global.epic_api.WebAuthorize(loginObject.epic_username, loginObject.password, cb_status);
		}
		else {
			cb_status(`Failed with status code: ${response.statusCode}`, false);
		}
		
	});
}

epic_api.prototype.WebAuthorize = function (user, pass, cb_status) {	
	var opts = {
		uri: 'https://accounts.unrealengine.com/authorize/index',
		headers: { Cookie: global.epic_api.GetWebCookieString(), Origin: 'allar_ue4_marketplace_commandline' },
		qs: { client_id: '43e2dea89b054198a703f6199bee6d5b', response_type: 'code', forWidget: 'true' }
	};
	
	request.get(opts, function(error, response, body) {
		global.epic_api.updateFakeJar(response.headers['set-cookie']);
		
		if (response.statusCode == 200) {
			var json = JSON.parse(body);
			var code = json.redirectURL.split('?code=')[1];
			if (cb_status != undefined) {
				cb_status('Successfully Web Authorized! Performing Web Exchange...', false);
			}
			global.epic_api.WebExchange(user, pass, code, cb_status);
		} else {
			if (cb_status != undefined) {
				cb_status('Web Auth failed: ' + JSON.stringify(response, null, ' '), false);
			}
		}
	});
}

epic_api.prototype.WebExchange = function (user, pass, code, cb_status) {
	var opts = {
		uri: 'https://www.unrealengine.com/exchange',
		headers: { Cookie: global.epic_api.GetWebCookieString() },
		qs: { code: code }
	};
	
	request.get(opts, function(error, response, body) {
		global.epic_api.updateFakeJar(response.headers['set-cookie']);
		
		if (response.statusCode == 302) {
			if (cb_status != undefined) {
				cb_status('Intentionally failed Web Exchage! Performing OAuth...', false);
			}
			global.epic_api.OAuthViaPassword(user, pass, cb_status);
		} else {
			if (cb_status != undefined) {
				cb_status('Web Exchange failed: ' + JSON.stringify(response, null, ' '), false);
			}
		}
	});
}

// Go through Epic's OAuth chain using a username and password
// cb_status is a callback with string parameter of current OAuth status and bool of whether complete. (status, bComplete)
epic_api.prototype.OAuthViaPassword = function (user, pass, cb_status) {	
	var opts = {
		uri: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token',
		headers: { Authorization: 'basic MzRhMDJjZjhmNDQxNGUyOWIxNTkyMTg3NmRhMzZmOWE6ZGFhZmJjY2M3Mzc3NDUwMzlkZmZlNTNkOTRmYzc2Y2Y=', Origin: 'allar_ue4_marketplace_commandline' },
		form: { grant_type: 'password', username: user, password: pass, includePerms: true }
	};
	
	request.post(opts, function(error, response, body) {
		if (response.statusCode == 200) {
			global.epic_oauth = JSON.parse(body);
			if (cb_status != undefined) {
				cb_status('Got OAuth token, exchanging for code', false);	
			}
			module.exports.OAuthExchange(cb_status);
		} else {
			if (cb_status != undefined) {
				cb_status('OAuth Via Password failed: ' + JSON.stringify(response, null, ' '), false);
			}
		}
	});
}

// cb_status is a callback with string parameter of current OAuth status and bool of whether complete. (status, bComplete)
epic_api.prototype.OAuthExchange = function(cb_status) {
	var opts = {
		uri: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/exchange',
		headers: { Authorization: 'bearer ' +  global.epic_oauth.access_token, Origin: 'allar_ue4_marketplace_commandline' }
	};
	
	request.get(opts, function(error, response, body) {
		if (response.statusCode == 200) {
			var json = JSON.parse(body);
			global.epic_oauth.code = json.code;
			if (cb_status != undefined) {
				if (global.epic_SSO === undefined)
				{
					cb_status('Got OAuth exchange code. Getting SSO.', false);
				}
				else
				{
					cb_status('Got OAuth exchange code. Skipping SSO.', true);
				}
			}
			// Grab our SSO token
			if (global.epic_SSO === undefined) {
				global.epic_api.GetSSOWithOAuthCode(cb_status);
			}
			// renew our token before it expires
			global.setTimeout(module.exports.OAuthExchange, 250 * 1000);
		} else {
			if (cb_status != undefined) {
				cb_status('OAuth renew failed: ' + JSON.stringify(response, null, ' '), false);
			}
		}
	});
}

// cb_status is a callback with string parameter of current OAuth status and bool of whether complete. (status, bComplete)
epic_api.prototype.GetSSOWithOAuthCode = function(cb_status) {
	var opts = {
		uri: 'https://accountportal-website-prod07.ol.epicgames.com/exchange?',
		headers: { Authorization: 'bearer ' +  global.epic_oauth.access_token, Origin: 'allar_ue4_marketplace_commandline' },
		qs: { exchangeCode: global.epic_oauth.code, state: '/getSsoStatus' }
	};

	request.get(opts, function(error, response, body) {
		//module.exports.updateFakeJar(response.headers['set-cookie']);
		
		if (response.statusCode == 302) {
			if (cb_status != undefined) {
				cb_status('Successfully Authorized!', true);
			}
		} else {
			if (cb_status != undefined) {
				cb_status('Failed', false);
			}
		}
	});
}

// Gets 'user-friendly' marketplace categories
// namespace 'ue': Marketplace items
// callback expects a bool indicating whether we fetched data, i.e. (success)
epic_api.prototype.GetMarketplaceCategories = function (cb) {	
	var opts = {
		uri: 'https://www.unrealengine.com/assets/ajax-get-categories',
		form: {category: 'assets/environments', start: 0},
		headers: { Origin: 'allar_ue4_marketplace_commandline'}
	};
	
	request.post(opts, function(error, response, body) {
		if (response.statusCode == 200) {
			global.marketplace_categories = JSON.parse(body).categories;
			if (cb != undefined) {
				cb(true);
			}
		} else {
			if (cb != undefined) {
				cb(false);
			}
		}
	});
}

// Used for Catalog data path, currently irrelevant as Catalog data doesn't offer ratings
// Get Category index by path
epic_api.prototype.GetCategoryIndex = function (category_path) {
	// Due to outdated Epic data, we have to fix up some paths
	switch (category_path) {
		case 'assets/fx':
		case 'assets/textures':
			category_path = 'assets/textures-fx';
			break;
		case 'assets/weapons':
		case 'assets/props':
			category_path = 'assets/weapons-props';
			break;
		case 'assets/soundfx':
		case 'assets/music':
			category_path = 'assets/music-soundfx';
			break;
		case 'assets/animations':
		case 'assets/characters':
			category_path = 'assets/characters-animations';
			break;
		case 'assets':
			return -1;
	}
	for (var i = 0; i < global.marketplace_categories.length; ++i) {
		if (global.marketplace_categories[i].path == category_path) {
			return i;
		}
	}
	console.warn("Couldn't find category index for " + category_path);
	return -1;
}

// UNUSED: Epic's catalog API doesn't give us ratings information
// Gets Catalog offers for the provided namespace
// namespace 'ue': Marketplace items
// callback expects a bool indicating whether we fetched data, i.e. (success)
epic_api.prototype.CatalogItems = function (namespace, cb) {
	if (global.epic_oauth === undefined) {
		if (cb != undefined) {
			cb(false);
		}
		return;
	}
	var opts = {
		uri: 'https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace/' + namespace + '/offers',
		headers: { Authorization: 'bearer ' + global.epic_oauth.access_token, Origin: 'allar_ue4_marketplace_commandline' },
		qs: { status: 'SUNSET|ACTIVE', country: 'US', locale: 'en', start: 0, count: 1000, returnItemDetails: true }
	};
	
	request.get(opts, function(error, response, body) {
		if (response.statusCode == 200) {
			global.marketplace = JSON.parse(body);
			if (cb != undefined) {
				cb(true);
			}
		} else {
			if (cb != undefined) {
				cb(false);
			}
		}
	});
}

// Due to Epic's catalog API not offering ratings, we might as well use the
// web API to grab everything as that does have all the data we'll ever need
// Also lists all available categories
// Takes function 'cb' with signature (json, path, finished)
// json: The json object Epic returned for that single fetch
// path: The category path that was fetched
// finished: bool whether that category is finished fetching
epic_api.prototype.getAssetsInCategory = function(category, start, addToTable, cb) {
	var opts = {
		uri: 'https://www.unrealengine.com/assets/ajax-get-categories',
		form: {category: category, start: start},
		headers: { Cookie: global.epic_api.GetWebCookieString(), Origin: 'allar_ue4_marketplace_commandline' },
	};	
	request.post(opts, function(error, response, body) {
		
		if (response.statusCode == 200) {
			var json = JSON.parse(body);
			var finished = false;
			if (addToTable == true) {
				
				// Add category definition if it doesn't exist (it should though)
				if (global.marketplace_ajax[json.categoryPath] === undefined) {
					global.marketplace_ajax[json.categoryPath] = { name: json.category.name };
				}
				
				// Add first set of assets to this category definition
				if (global.marketplace_ajax[json.categoryPath].assets === undefined) {
					global.marketplace_ajax[json.categoryPath].assets = json.assets;
				} else { // Add assets to category definition
					json.assets.forEach(function(v) {global.marketplace_ajax[json.categoryPath].assets.push(v);});
				}
				
				// If this is the first grab for assets of this category, kick off grabbing the rest
				if (start == 0) {
					global.marketplace_ajax[json.categoryPath].assetCount = json.assetCount;
					for (var i = 0; i < Math.floor((json.assetCount-1) / json.assetPerPage); ++i) {
						module.exports.getAssetsInCategory(json.categoryPath, (i+1)*json.assetPerPage, true, function (nextjson, nextpath, nextfinished) {
							cb(nextjson, nextpath, nextfinished);
						});	
					}
				}
				
				if (global.marketplace_ajax[json.categoryPath].assets.length == global.marketplace_ajax[json.categoryPath].assetCount) {
					console.log("Done getting assets for category: " + json.categoryPath);
					finished = true;
				}
			}
			cb(json, json.categoryPath, finished);
		} else {
			console.error(response);
		}
	});
}

epic_api.prototype.getAllMarketplaceAssets = function(cb_done) {
	global.fetching = true;

	var categoriesLeft = global.marketplace_categories.length;
			
	// Build Category List
	for (var i = 0; i < global.marketplace_categories.length; ++i) {
		global.marketplace_ajax[global.marketplace_categories[i].path] = { name: global.marketplace_categories[i].name };
		module.exports.getAssetsInCategory(global.marketplace_categories[i].path, 0, true, function (json, path, finished) { 
			if(finished) {
				categoriesLeft--;
				if (categoriesLeft == 0) {
					global.fetching = false;
					if (cb_done != undefined) {
						cb_done();
					}
				}
			}
		});
	}		
}

epic_api.prototype.GetOwnedAssets = function (cb) {
	if (global.epic_oauth === undefined) {
		if (cb != undefined) {
			cb(false);
		}
		return;
	}
	var opts = {
		// From launcher: https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/public/assets/Windows?label=Live
		uri: 'https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/public/assets/Windows',
		headers: { Authorization: 'bearer ' + global.epic_oauth.access_token, 'User-Agent': 'game=UELauncher, engine=UE4, build=allar_ue4_marketplace_commandline' },
		qs: { label: 'Live' }
	};
	
	console.log('Checking for EULA and fetching owned assets...');
	
	request.get(opts, function(error, response, body) {
		if (response.statusCode == 200) {
			if (body == "[ ]") {
				console.error("Failed to fetch owned assets. This might be because you need to accept the Epic Launcher EULA for your account, or you own zero assets.");
				process.exit(0);
				return;
			}
			global.marketplace_ownedAssets = JSON.parse(body);

			var itemsPending = global.marketplace_ownedAssets.length;
			var itemsTotal = itemsPending;
			var itemsToIgnore = 0;

			var bar = new ProgressBar('Fetching Info: :bar :percent Completed. (ETA: :eta seconds)', {total: itemsPending});

			global.marketplace_ownedAssets.forEach( (arrayItem) => {
				if (!global.marketplace_ownedAssets_consolidated.hasOwnProperty(arrayItem.catalogItemId)) {
					global.marketplace_ownedAssets_consolidated[arrayItem.catalogItemId] = arrayItem;
					global.epic_api.GetConsolidatedAssetInfo(arrayItem.catalogItemId, (success) => {
						itemsPending--;
						bar.update((itemsTotal - itemsToIgnore - itemsPending) / (itemsTotal - itemsToIgnore));
						if (itemsPending == 0) {
							if (cb != undefined) {
								console.log(`Fetched all (${Object.keys(global.marketplace_ownedAssets_consolidated).length}) assets.`);
								cb(true);
							}
						}
					});
				} else {
					itemsToIgnore++
					itemsPending--;
					bar.update((itemsTotal - itemsToIgnore - itemsPending) / (itemsTotal - itemsToIgnore));	
				}
			});
		} else {
			console.log('Failed to fetch assets.');
			if (cb != undefined) {
				cb(false);
			}
		}
	});
}

epic_api.prototype.GetConsolidatedAssetInfo = function (catalogItemId, cb) {
	if (global.epic_oauth === undefined) {
		if (cb != undefined) {
			cb(false);
		}
		return;
	}
	var opts = {
		// From launcher: https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/bulk/items?id=5e0f8343b8cd44a0817214ab0d39847f&country=US&locale=en-US
		uri: 'https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/bulk/items',
		headers: { Authorization: 'bearer ' + global.epic_oauth.access_token, Origin: 'allar_ue4_marketplace_commandline', 'User-Agent': 'game=UELauncher, engine=UE4, build=allar_ue4_marketplace_commandline' },
		qs: { id: catalogItemId, country: 'US', locale: 'en-US' },
		pool: slowRequestPool
	};
	
	request.get(opts, function(error, response, body) {
		if (error !== null) {
			console.log('Error getting consolidated info.');
			if (cb != undefined) {
				cb(false);
			}
			return;
		}
		if (response.statusCode == 200) {
			var itemInfo = JSON.parse(body);
			global.marketplace_ownedAssets_consolidated[Object.keys(itemInfo)[0]] = itemInfo[Object.keys(itemInfo)[0]];
			if (cb != undefined) {
				cb(true);
			}
		} else {
			if (cb != undefined) {
				cb(false);
			}
		}
	});
}

epic_api.prototype.GetEngineVersionsForItem = function (itemInfo) {
	var versions = [];
	itemInfo.releaseInfo.forEach( (releaseInfo) => {
		if (!releaseInfo.hasOwnProperty("compatibleApps")) {
			return versions;
		}
		releaseInfo.compatibleApps.forEach( (compatibleApp) => {
			var minorVersion = Number(compatibleApp.replace("UE_4.", ""));
			versions.push({title: `4.${minorVersion}`, appId: releaseInfo.appId, version: compatibleApp, minorVersion: minorVersion });
		});
	});
	// Sorts latest version first
	versions.sort( (a, b) => {
		if (a.minorVersion > b.minorVersion) return -1;
		if (a.minorVersion < b.minorVersion) return 1;
		return 0;
	});
	return versions;
}

// Gets an item's build info. Callback is of form (error, buildinfo)
epic_api.prototype.GetItemBuildInfo = function (catalogItemId, appId, cb) {
	if (global.epic_oauth === undefined) {
		if (cb != undefined) {
			cb("Not authed.", null);
		}
		return;
	}
	var opts = {
		// From launcher: https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/public/assets/Windows/cd2c274e32764e4b9bba09115e732fde/MagicEffects411?label=Live
		uri: `https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/public/assets/Windows/${catalogItemId}/${appId}`,
		headers: { Authorization: 'bearer ' + global.epic_oauth.access_token, Origin: 'allar_ue4_marketplace_commandline', 'User-Agent': 'game=UELauncher, engine=UE4, build=allar_ue4_marketplace_commandline' },
		qs: { label: 'Live' },
	};

	console.log("Getting item build info.");
	
	request.get(opts, function(error, response, body) {
		if (error !== null) {
			console.log('Error getting item build info.');
			if (cb != undefined) {
				cb(error, null);
			}
			return;
		}
		if (response.statusCode == 200) {
			var manifest = JSON.parse(body);
			if (cb != undefined) {
				cb(null, manifest)
			}
		} else {
			if (cb != undefined) {
				console.log('Error getting item build info. Error code: ' + response.statusCode);
				cb(body, null);
			}
		}
	});
}

// Gets an item's manifest. Callback is of form (error, manifest)
// Note: This call does not require auth. (lol?) E: It now does by needing the signature.
epic_api.prototype.GetItemManifest = function (itemBuildInfo, cb) {
	var opts = {
		uri: itemBuildInfo.items.MANIFEST.distribution + itemBuildInfo.items.MANIFEST.path + "?" + itemBuildInfo.items.MANIFEST.signature,
		headers: { Origin: 'allar_ue4_marketplace_commandline', 'User-Agent': 'game=UELauncher, engine=UE4, build=allar_ue4_marketplace_commandline' },
	};

	console.log("Getting item manifest.");
	
	request.get(opts, function(error, response, body) {
		if (error !== null) {
			console.log('Error getting item manifest.');
			if (cb != undefined) {
				cb(error, null);
			}
			return;
		}
		if (response.statusCode == 200) {
			var manifest = JSON.parse(body);
			if (cb != undefined) {
				cb(null, manifest)
			}
		} else {
			if (cb != undefined) {
				console.log('Error getting item manifest. Error code: ' + response.statusCode);
				cb(body, null);
			}
		}
	});
}

// Hash Functions

var HexChars = ["0", "1", "2", "3", "4", "5", "6", "7","8", "9", "A", "B", "C", "D", "E", "F"];

function ByteToHex(b) {
  return HexChars[(b >> 4) & 0x0f] + HexChars[b & 0x0f];
}

// Takes hash of 24-character decimal form (8 * 3char) and outputs 16-character hex in reverse byte order
function ChunkHashToReverseHexEncoding(chunk_hash) {
	var out_hex = '';
	
	for (var i = 0; i < 8; ++i) {
		out_hex = ByteToHex(parseInt(chunk_hash.substring(i*3, i*3+3))) + out_hex;
	}
	return out_hex;
}

// Pads a string with leading zeros or passed in string, i.e. padLeft(4,2) = "04"
// http://stackoverflow.com/questions/5366849/convert-1-to-0001-in-javascript
function padLeft(nr, n, str){
	return Array(n-String(nr).length+1).join(str||'0')+nr;
}

epic_api.prototype.BuildItemChunkListFromManifest = function (manifest) {
	// Build chunk URL list
	var chunks = [];
	//Ref: https://download.epicgames.com/Builds/Rocket/Automated/MagicEffects411/CloudDir/ChunksV3/22/AAC7EF867364B218_CE3BE4D54E7B4ECE663C8EAC2D8929D6.chunk
	var chunkBaseURL = `http://download.epicgames.com/Builds/Rocket/Automated/${manifest.AppNameString}/CloudDir/ChunksV3/`;
	for ( var chunk in manifest.ChunkHashList )
	{
		var hash = ChunkHashToReverseHexEncoding(manifest.ChunkHashList[chunk]);
		var group = padLeft(parseInt(manifest.DataGroupList[chunk]), 2);
		var filename = chunk+'.chunk';
		chunks.push({guid: chunk, hash: hash, url: chunkBaseURL + group + '/' +	hash + '_' + chunk + '.chunk', filename: filename});
	}
	return chunks;
}

// cb is in format (finished, chunkDir)
epic_api.prototype.DownloadItemChunkList = function (manifest, chunkList, downloadDirBase, cb) {
	var downloadDir = `${downloadDirBase}${manifest.AppNameString}/chunks/`;
	rimraf.sync(downloadDir + '*.*'); // Purge chunk folder
	mkdirp.sync(downloadDir) // Ensure path exists after purge

	var downloads = [];

	chunkList.forEach( (chunk) => {
		downloads.push(chunk.url);
	});

	console.log("Downloading item chunks.");

	// Perform downloads
	var bar = new ProgressBar('Progress: (:current / :totalMB) :bar :percent Completed. (ETA: :eta seconds)', {total: chunkList.length});
	var downloadList = downloads; // really stupid code
	downloadList.forEach( (downloadItem) => {
		download(downloadItem, { directory: downloadDir, timeout: 50000 }, (err) => {
			if (err) throw err;
			bar.tick();
			downloads.pop();
			if (downloads.length == 0 && cb != undefined) {
				cb(true, downloadDir);
			}
		});
	}); 
}

// cb is in format (finished)
epic_api.prototype.ExtractAssetFilesFromChunks = function (manifest, chunkDir, downloadDirBase, cb) {
	var extractDir = `${downloadDirBase}${manifest.AppNameString}/extracted/`;
	rimraf.sync(extractDir + '*.*'); // Purge chunk folder
	mkdirp.sync(extractDir) // Ensure path exists after purge

	console.log("Fixing up chunk files...");
	var chunkFiles = fs.readdirSync(chunkDir);

	// strip chunk hashes from files, we do this to make some code simpler at the cost of IO
	var bar = new ProgressBar('Fixing Up Chunk Files: Progress: (:current / :totalMB) :bar :percent Completed. (ETA: :eta seconds)', {total: chunkFiles.length});
	chunkFiles.forEach((file) => {
		fs.renameSync(chunkDir + file, chunkDir + file.substring(17));
		bar.tick();
	});

	// Get renamed list of files
	chunkFiles = fs.readdirSync(chunkDir);

	console.log("Decompressing files...");

	// decompress chunk files
	bar = new ProgressBar('Decompressing Chunk Files: Progress: (:current / :totalMB) :bar :percent Completed. (ETA: :eta seconds)', {total: chunkFiles.length});
	chunkFiles.forEach( (chunkFileName) => {
		var file = fs.openSync(chunkDir + chunkFileName, 'r');

		// We need to first read a chunk's header to find out where data begins and if its compressed
		// Header details can be found in Engine\Source\Runtime\Online\BuildPatchServices\Private\BuildPatchChunk.cpp
		// Header size is stored in the 9th byte (index 8)
		// Whether a file is compressed is always at header byte 41 (index 0)
		var headerBuffer = new Buffer(41);
		fs.readSync(file, headerBuffer, 0, 41, 0);

		var headerSize = headerBuffer[8];
		var compressed = (headerBuffer[40] == 1);

		var stats = fs.statSync(chunkDir + chunkFileName);
		var chunkBuffer = new Buffer(stats['size'] - headerSize);
		fs.readSync(file, chunkBuffer, 0, stats['size']-headerSize, headerSize);
		fs.closeSync(file);

		if (compressed) {
			fs.writeFileSync(chunkDir + chunkFileName, zlib.unzipSync(chunkBuffer));
		} else {
			fs.writeFileSync(chunkDir + chunkFileName, chunkBuffer);
		}

		headerBuffer = null;
		chunkBuffer = null;

		bar.tick();
	});

	// Extract assets from chunks
	bar = new ProgressBar('Extracting Asset Files: Progress: (:current / :total) :bar :percent Completed. (ETA: :eta seconds)', {total: manifest.FileManifestList.length});
	manifest.FileManifestList.forEach( (fileList) => {
		var fileSize = 0;
		var fileName = extractDir + fileList.Filename;
		var fileDir = fileName.substring(0, fileName.lastIndexOf('/'));
		mkdirp.sync(fileDir); // Create asset file folder if it doesn't exist

		// Calculate total asset file size
		fileList.FileChunkParts.forEach( (chunkPart) => {
			fileSize += parseInt('0x'+ChunkHashToReverseHexEncoding(chunkPart.Size));
		});

		var buffer = new Buffer(fileSize);
		var bufferOffset = 0;

		// Start reading chunk data and assembling it into a buffer
		fileList.FileChunkParts.forEach( (chunkPart) => {
			var chunkGuid = chunkPart.Guid;
			var chunkOffset = parseInt('0x'+ChunkHashToReverseHexEncoding(chunkPart.Offset));
			var chunkSize = parseInt('0x'+ChunkHashToReverseHexEncoding(chunkPart.Size));

			var file = fs.openSync(chunkDir + chunkGuid + '.chunk', 'r');
			fs.readSync(file, buffer, bufferOffset, chunkSize, chunkOffset);
			fs.closeSync(file);
			bufferOffset += chunkSize;
		});

		// Write out the assembled buffer
		fs.writeFileSync(fileName, buffer);
		buffer = null;
		bar.tick();
	});

	console.log("Removing chunk files.");
	rimraf.sync(chunkDir + "*.*"); // Remove no-longer needed chunk dir

	if (cb != undefined) {
		cb(true);
	}
}



module.exports = new epic_api();
