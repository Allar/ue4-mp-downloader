# ue4-mp-downloader
Shell utility to download owned assets from the UE4 marketplace.

# Support

I offer ZERO support. If you have a problem with this, please post an issue but I don't guarantee I'll resolve it. I wrote this tool for myself since I need to grab a bunch of marketplace assets on a Linux machine and was too lazy to copy paste files around.

# Legal

For this tool to work, you must have already accepted Epic's Terms (on account registration) and relevant EULAs (prompted when you open the Launcher for the first time or buy a marketplace item).

This tool can only download assets you own.

I have inquired Epic in the past about the legality of custom marketplace tools when developing other tools I have made. Epic Games seems to not have a problem with this. I mean no foul or infringement, and I will take this repo down immediately at the request of Epic Games if they do so.

# Disclaimer

Everything here is offered as-is. If bad things happen, including but not limited to burning down your house or gives your mom a rash, I am not responsible.

# Installation

1. Install NodeJS if you don't already have it installed: https://nodejs.org/en/download/package-manager/
1. `npm install -g Allar/ue4-mp-downloader`

# Usage

Run `ue4-mp-downloader`

You will be prompted to log in. This tool does not save or record your credentials for your safety, so you will have to log in every time you use it. Once logged in, any assets downloaded will be downloaded to your current working directory in a folder called `download`.
