import type { PackFile } from "./types.ts";

export type RamAdvice = { minMb: number; maxMb: number; reason: string };

export function recommendRam(files: PackFile[], minecraftVersion: string): RamAdvice {
  const mods = files.filter((f) => f.included && f.path.startsWith("mods/") && f.path.endsWith(".jar"));
  const n = mods.length;
  const modern = minecraftVersion.startsWith("26.") || compareLoose(minecraftVersion, "1.18") >= 0;
  let minMb = 2048;
  let maxMb = 4096;
  if (n >= 250) {
    minMb = 8192;
    maxMb = 12288;
  } else if (n >= 150) {
    minMb = 6144;
    maxMb = 10240;
  } else if (n >= 80) {
    minMb = 4096;
    maxMb = 8192;
  } else if (n >= 20) {
    minMb = 4096;
    maxMb = 6144;
  }
  if (modern && maxMb < 4096) maxMb = 4096;
  return {
    minMb,
    maxMb,
    reason: `${n} included mods${modern ? " on a 1.18+ or 26.x server" : ""}. This is a starting point, not a benchmark of your machine.`,
  };
}

function compareLoose(a: string, b: string): number {
  const pa = a.split(".").map((p) => Number(p) || 0);
  const pb = b.split(".").map((p) => Number(p) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export const G1_FLAGS =
  "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1";
