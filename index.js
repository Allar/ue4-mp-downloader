"use strict";
// UE4-MARKETPLACE-COMMANDLINE
//
// This is a very hastly written commandline app so I can fetch marketplace items on Linux
// Warning: Here be dragons


// Normally don't need to do this global bullshit but this library is used in another JS app that requires it
// So instead of maintaining two copies of this api, we just re-use it like this
global.request = (global.request === undefined) ? require('request') : global.request;
global.request = request.defaults({followRedirect: false, followAllRedirects: false});
global.epic_api = (global.epic_api === undefined) ? require('./epic_api.js') : global.epic_api;

const prompt = require('prompt');
const cheerio = require('cheerio');
const menu = require('console-menu');

function SerializeLoginFormArray(form) {
	var result = {};
	form.forEach((element) => {
		result[element.name] = element.value;
	});
	return result;
}

var promptSchema = {
	properties: {
		username: {
			required: true,
			type: 'string'
		},
		password: {
			required: true,
			type:'string',
			hidden: true,
			replace: '*'
		}
	}
};

// Error handling is for smart people
// We are not smart today

function TryLogin() {
	// If Epic's login page is down for some reason, we should probably handle it somehow
	epic_api.GetWebLoginForm( (body) => {
		prompt.start();
		prompt.get(promptSchema, (err, result) => {
			if (result == undefined || result.username == undefined) {
				process.exit(0); // Control+C
			}
			const $ = cheerio.load(body);
			var loginData = SerializeLoginFormArray($('form#loginForm').serializeArray());
			loginData.epic_username = result.username;
			loginData.password = result.password;
			epic_api.WebLogin(loginData, OnLogin);
		});
	});
}

 
// Return error codes for WebLogin are retarded and should be hardcoded to sane values
// I was probably drunk when writing epic_api.js
function OnLogin(status, complete) {
	if (status === 'Failed') {
		console.log("Failed to log in.");
		TryLogin();
		return;
	}

	console.log(status);

	// If for some reason the login chain fails but doesn't complete, theres no error handling
	// The log above *should* log the login chain failure and execution *should* just stop.
	if (complete == true) {
		epic_api.GetOwnedAssets( (success) => {
			var items = [];
			Object.keys(global.global.marketplace_ownedAssets_consolidated).forEach( (key) => {
				if (global.global.marketplace_ownedAssets_consolidated[key].developer == "Epic Games") // Epic examples returning 403?
					return;

				var isAsset = global.global.marketplace_ownedAssets_consolidated[key].categories.find ( (cat) => {
					return (cat.path == "assets" || cat.path == "projects" || cat.path == "plugins")
				});
				if (isAsset) {
					items.push(global.global.marketplace_ownedAssets_consolidated[key]);
				}
			});

			// Sort items alphabetically
			items.sort( (a, b) => {
				if (a.title < b.title) return -1;
				if (a.title > b.title) return 1;
				return 0;
			});

			(function MenuLoop() {
				ShowDownloadAssetsMenu(items, () => {
					MenuLoop();
				});
			})();			
		});
	};
}

function ShowDownloadAssetsMenu(items, cb) {
	console.log('\x1Bc'); // clear screen

	var helpMessage = "Scroll using Up/Down, arrow keys, or Page Up / Page Down. Press Control+C to quit.";
	
	menu(items, { header: 'Select a Marketplace Asset to Download', pageSize: 10, border: true, helpMessage: helpMessage})
	.then( (item) => {
		if (item == undefined) {
			process.exit(0); // Control+C
			return;
		}

		var versions = global.epic_api.GetEngineVersionsForItem(item);
		menu(versions, { header: item.title + ' - Choose Engine Version', border: true, helpMessage: helpMessage})
		.then( (version) => {
			if (version == undefined) {
				process.exit(0); // Control+C
				return;
			}
			global.epic_api.GetItemBuildInfo(item.id, version.appId, (error, buildinfo) => {
				if (error !== null) {
					console.error('Failed to get item build info. ' + error);
					return;
				}

				global.epic_api.GetItemManifest(buildinfo, (error, manifest) => {
					if (error !== null) {
						console.error('Failed to get item manifest. ' + error);
						return;
					}
					var chunkList = global.epic_api.BuildItemChunkListFromManifest(manifest);
					global.epic_api.DownloadItemChunkList(manifest, chunkList, "./download/", (finishedDownloading, chunkDir) => {
						if (finishedDownloading) {
							global.epic_api.ExtractAssetFilesFromChunks(manifest, chunkDir, "./download/", (finishedExtracting) => {
								if (finishedExtracting) {
									console.log(item.title + ' build ' + version.appId + ' successfully extracted. Going back to download menu...');
									if (cb != undefined) {
										setTimeout(cb, 5000);
									}
								}
							})
						}
					});
				});
			});
		});
	});
}

TryLogin();