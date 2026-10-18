import { strToU8, zipSync } from "fflate";
import { installPs1, jvmFile, serverProperties, startBat, startSh } from "./scripts.ts";
import type { ServerRecord } from "./types.ts";

export function buildServerZip(server: ServerRecord): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "server.properties": strToU8(serverProperties(server)),
    "eula.txt": strToU8(`#By changing this setting you are indicating your agreement to Mojang's EULA (https://aka.ms/MinecraftEULA).\neula=${server.eulaAccepted ? "true" : "false"}\n`),
    "craftserver-jvm.txt": strToU8(jvmFile(server)),
    "start.bat": strToU8(startBat(server)),
    "start.sh": strToU8(startSh(server)),
    "install.ps1": strToU8(installPs1(server)),
    "queued-commands.txt": strToU8(server.queuedCommands.join("\n") + (server.queuedCommands.length ? "\n" : "")),
    "craftserver.json": strToU8(
      JSON.stringify(
        {
          name: server.name,
          minecraft: server.minecraftVersion,
          loader: server.loader,
          loaderVersion: server.loaderVersion,
          java: server.javaMajor,
          javaSource: server.javaSource,
          officialServerPack: server.pack.officialServerPack,
          note: "World, whitelist, ops, and an existing server.properties are not replaced by install.ps1.",
        },
        null,
        2,
      ),
    ),
    "README.txt": strToU8(
      [
        server.name,
        `${server.pack.sourceLabel} ${server.pack.version}`,
        `Minecraft ${server.minecraftVersion} / ${server.loader} ${server.loaderVersion}`,
        `Java ${server.javaMajor} (${server.javaSource})`,
        "",
        "1. Run install.ps1 in PowerShell. It downloads Java, the loader, and included mods.",
        "2. Run start.bat. Forge and NeoForge call run.bat after the installer.",
        "3. Agree to the Minecraft EULA only if eula.txt says true.",
        "",
        server.javaNote,
        server.pack.serverPackNote,
        "",
      ].join("\r\n"),
    ),
  };
  return zipSync(files, { level: 6 });
}

export function downloadZip(server: ServerRecord) {
  const bytes = buildServerZip(server);
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${server.directoryLabel.replace(/^servers\//, "")}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
