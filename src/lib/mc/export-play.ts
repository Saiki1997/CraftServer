import { strToU8, zipSync } from "fflate";
import { playInstallPs1, playStartBat } from "./play-scripts.ts";
import type { PlayRecord } from "./types.ts";

export function downloadPlayZip(play: PlayRecord) {
  const files: Record<string, Uint8Array> = {
    "install.ps1": strToU8(playInstallPs1(play)),
    "start.bat": strToU8(playStartBat(play)),
    "craft.json": strToU8(JSON.stringify({
      role: "play",
      name: play.name,
      minecraft: play.minecraftVersion,
      loader: play.loader,
      loaderVersion: play.loaderVersion,
      java: play.javaMajor,
      width: play.width,
      height: play.height,
      ramMinMb: play.ramMinMb,
      ramMaxMb: play.ramMaxMb,
      note: "Client mods stay included. This app does not start Minecraft or collect a Microsoft account.",
    }, null, 2)),
    "README.txt": strToU8([
      play.name,
      "Play instance",
      `Minecraft ${play.minecraftVersion} / ${play.loader} ${play.loaderVersion}`,
      `Java ${play.javaMajor}`,
      "",
      "1. Run install.ps1 in PowerShell. It downloads Java, the client jar, the loader, and included mods.",
      "2. start.bat only prints the instance summary. It does not launch the game.",
      "3. Playing still needs a Microsoft account you own. This folder does not contain one.",
      "",
      play.javaNote,
      "",
    ].join("\r\n")),
  };
  const bytes = zipSync(files, { level: 6 });
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${play.directoryLabel.replace(/^play\//, "")}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
