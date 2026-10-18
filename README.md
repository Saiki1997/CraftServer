# CraftServer

From a modpack to a Minecraft client instance or a dedicated server folder. Paste a Modrinth, CurseForge, FTB, Technic, ATLauncher, or GitHub pack link, or drop a `.mrpack` / `.zip`. Craft reads the Minecraft version and loader, picks a Java runtime, and downloads a folder you start on your own computer.

**Play** keeps client mods. **Host** leaves client-only mods out of the server. Neither process runs inside the app. `install.ps1` in the downloaded folder does the downloads on Windows. Playing still needs a Microsoft account you own. The app does not collect one.

## Run from source

```bash
npm install
npm run dev
```

Open the app, paste a pack link, and install. Servers stay in this browser until you download the folder.

## Windows app

A portable Windows build is not stored in this repository (the archive is larger than GitHub’s file limit). From a built desktop bundle:

```bash
CRAFT_DESKTOP=1 npm run build
```

That writes a Node server to `desktop/bundle`. The desktop window lives in `desktop/main.mjs` and is meant to sit inside an Electron `resources/app` folder next to `server/` and `public/`.

## Import

- Modrinth project or version URLs, including the `.mrpack` index (`env.server` decides client-only mods).
- CurseForge modpack URLs. Without an API key, an exact Modrinth slug match is used and labeled as such. With a key from CurseForge, the official API is used, including `serverPackFileId` when present.
- CurseForge export ZIPs (`manifest.json`) and Modrinth ZIPs (`modrinth.index.json`). The original archive is not modified.
- FTB pack URLs with a numeric id (`api.modpacks.ch`), using `clientonly` flags.
- Technic and ATLauncher metadata. These do not invent a file list. Install is not marked successful without files.
- GitHub release assets that are `.mrpack` or `.zip`.

Unknown mod sides stay included. Client-only mods are excluded only when metadata says the server does not support them.

## Java

Java comes from Mojang’s version metadata when that exact Minecraft version is listed, otherwise from the pack, otherwise from a compatibility table (including Java 25 for 26.x and Java 8 for legacy Forge). Builds are Eclipse Temurin JREs from Adoptium, per server, under `runtime/javaXX`. A manual path is stored but not executed here.

## What the download contains

`server.properties`, `eula.txt`, JVM flags, `start.bat`, `start.sh`, and `install.ps1`. The script retries downloads, checks SHA-1 or SHA-256, refuses zip paths that contain `..`, and will not replace an existing world, ops list, whitelist, or `server.properties`.

## Saved data

Servers, snapshots, and the optional CurseForge key live in this browser. The key is not encrypted.
