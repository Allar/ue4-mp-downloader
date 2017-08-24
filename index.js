#!/usr/bin/env node
"use strict";
const argv = require('yargs').argv;

if (argv.manifests) {
    require('./manifests.js');
} else if (argv.evil) {
    require('./evil.js');
} else {
    require('./downloader.js');
}
