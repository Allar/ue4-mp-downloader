"use strict";
// Warning: Here be dragons


// Normally don't need to do this global bullshit but 'epic_api.js' is used in another JS app that requires it
// So instead of maintaining two copies of this api, we'll just re-use it like this
// @TODO: Learn how to do all this the right way
global.request = (global.request === undefined) ? require('request') : global.request;
global.request = request.defaults({followRedirect: false, followAllRedirects: false});
global.epic_api = (global.epic_api === undefined) ? require('./epic_api.js') : global.epic_api;

const prompt = require('prompt');
const cheerio = require('cheerio');
const menu = require('console-menu');
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');

// Takes an HTML form from cheerio.serializeArray() and converts it to an object suitable for the 'request' module
function SerializeLoginFormArray(form) {
	var result = {};
	form.forEach((element) => {
		result[element.name] = element.value;
	});
	return result;
}

// Ask for username/password from the user
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

function cleanEmptyFoldersRecursively(folder) {
    var isDir = fs.statSync(folder).isDirectory();
    if (!isDir) {
      return;
    }
    var files = fs.readdirSync(folder);
    if (files.length > 0) {
      files.forEach(function(file) {
        var fullPath = path.join(folder, file);
        cleanEmptyFoldersRecursively(fullPath);
      });

      // re-evaluate files; after deleting subfolder
      // we may have parent folder empty now
      files = fs.readdirSync(folder);
    }

    if (files.length == 0) {
      console.log("removing: ", folder);
      fs.rmdirSync(folder);
      return;
    }
  }

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
	// Theres a lot of assumptions being made because my test sample count is 1.
	if (complete == true) {
		epic_api.GetOwnedAssets( (success) => {
			var items = [];
			Object.keys(global.global.marketplace_ownedAssets_consolidated).forEach( (key) => {
				if (global.marketplace_ownedAssets_consolidated[key].developer == "Epic Games") // Epic examples returning 403?
					return;

				var isAsset = global.marketplace_ownedAssets_consolidated[key].categories.find ( (cat) => {
					return (cat.path == "assets" || cat.path == "projects" || cat.path == "plugins")
				});
				if (isAsset) {
					items.push(global.marketplace_ownedAssets_consolidated[key]);
					mkdirp.sync('./dump/buildinfo/' + global.marketplace_ownedAssets_consolidated[key].id)
					mkdirp.sync('./dump/manifests/' + global.marketplace_ownedAssets_consolidated[key].id)
				}	
			});

			// Sort items alphabetically
			items.sort( (a, b) => {
				if (a.title < b.title) return -1;
				if (a.title > b.title) return 1;
				return 0;
			});

			var itemVersions = [];

			items.forEach( (item) => {
				item.releaseInfo.forEach( (versionInfo) => {
					versionInfo.catalogItemId = item.id;
					versionInfo.title = item.title;
					itemVersions.push(versionInfo);
				});
			});

			var buildInfos = [];
			var failures = 0;

			itemVersions.forEach( (version) => {
				global.epic_api.GetItemBuildInfo(version.catalogItemId, version.appId, (error, buildinfo) => {
					if (error !== null) {
						failures++;
					} else {
						buildinfo.title = version.title;
						fs.writeFileSync('./dump/buildinfo/' + version.catalogItemId + '/' + version.appId, JSON.stringify(buildinfo, null, '\t'));
						buildInfos.push(buildinfo);
					}
					if (buildInfos.length + failures == itemVersions.length) {
						console.log("All possible build info items fetched.");
						var manifestWrites = 0;
						buildInfos.forEach( (storedBuildInfo) => {
							global.epic_api.GetItemManifest(storedBuildInfo, (manifestError, manifest) => {
								manifestWrites++;
								if (manifestError == null) {
									manifest.catalogItemId = storedBuildInfo.catalogItemId;
									manifest.title = storedBuildInfo.title;
									fs.writeFileSync('./dump/manifests/' + manifest.catalogItemId + '/' + storedBuildInfo.appName + '.json', JSON.stringify(manifest, null, '\t'));
									fs.writeFileSync('./dump/manifests/' + manifest.catalogItemId + '/title.json', JSON.stringify({title: storedBuildInfo.title}, null, '\t'));
								}
								if (manifestWrites == buildInfos.length) {
									cleanEmptyFoldersRecursively('./dump/');
									console.log("Dumped all manifests.");
									process.exit(0);
									return;
								}
							});
						})
					}
				});
			});
		});
	};
}


TryLogin();
