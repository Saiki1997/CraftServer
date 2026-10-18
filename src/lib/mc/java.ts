import type { LoaderKind } from "./types.ts";

export type JavaGuess = {
  major: number;
  source: "compatibility-table";
  note: string;
};

/** Numeric compare for Minecraft ids: 1.20.5, 1.21.11, 26.1, 26.1.2. */
export function compareMc(a: string, b: string): number {
  const pa = a.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
  const pb = b.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function isForgeLegacyJava8(version: string, loader: LoaderKind): boolean {
  return loader === "forge" && compareMc(version, "1.13") < 0;
}

/**
 * Offline compatibility table. Callers must prefer Mojang `javaVersion`
 * metadata, then a pack-published runtime, and only then this table.
 */
export function javaFromTable(version: string, loader: LoaderKind): JavaGuess {
  const v = version.trim();
  if (!v || v === "unknown") {
    return {
      major: 21,
      source: "compatibility-table",
      note: "Minecraft version is unknown, so Java 21 is only a placeholder. Do not install until the version is detected.",
    };
  }
  if (isForgeLegacyJava8(v, loader)) {
    return {
      major: 8,
      source: "compatibility-table",
      note: "Forge on 1.12.2 and older requires Java 8. Newer Java removes APIs that Forge needs.",
    };
  }
  const parts = v.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (parts[0] === 26 || (Number.isFinite(parts[0]) && parts[0] >= 26 && parts[0] < 100)) {
    return {
      major: 25,
      source: "compatibility-table",
      note: "Minecraft 26.1 and newer require Java 25. Confirm with Mojang version metadata when this version is online.",
    };
  }
  if (parts[0] === 1 && Number.isFinite(parts[1])) {
    if (compareMc(v, "1.20.5") >= 0) {
      return {
        major: 21,
        source: "compatibility-table",
        note: "Minecraft 1.20.5 through 1.21.x require Java 21. Confirm with Mojang version metadata when online.",
      };
    }
    if (compareMc(v, "1.18") >= 0) {
      return {
        major: 17,
        source: "compatibility-table",
        note: "Minecraft 1.18 through 1.20.4 require Java 17. Confirm with Mojang version metadata when online.",
      };
    }
    if (compareMc(v, "1.17") >= 0) {
      return {
        major: 16,
        source: "compatibility-table",
        note: "Minecraft 1.17 requires Java 16. Confirm with Mojang version metadata when online.",
      };
    }
    return {
      major: 8,
      source: "compatibility-table",
      note: "Minecraft 1.16.5 and older run on Java 8. Confirm with Mojang version metadata when online.",
    };
  }
  return {
    major: 21,
    source: "compatibility-table",
    note: `Version "${v}" is not in the compatibility table. Java 21 is unverified until Mojang metadata loads.`,
  };
}

export function parseJavaMajor(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = raw.match(/\d+/);
  if (!match) return undefined;
  const n = Number(match[0]);
  if (n === 1) {
    const minor = raw.match(/1\.(\d+)/);
    if (minor) return Number(minor[1]);
  }
  return n >= 8 && n <= 40 ? n : undefined;
}

export function chooseJava(opts: {
  version: string;
  loader: LoaderKind;
  mojangMajor?: number;
  packMajor?: number;
}): { major: number; source: "mojang-metadata" | "pack" | "compatibility-table"; note: string } {
  const table = javaFromTable(opts.version, opts.loader);
  if (isForgeLegacyJava8(opts.version, opts.loader)) {
    return table;
  }
  if (opts.mojangMajor && opts.mojangMajor >= 8) {
    const note =
      opts.packMajor && opts.packMajor !== opts.mojangMajor
        ? `Mojang metadata requires Java ${opts.mojangMajor}. The pack published Java ${opts.packMajor}. Using Mojang's requirement.`
        : `Java ${opts.mojangMajor} comes from Mojang's version metadata for ${opts.version}.`;
    return { major: opts.mojangMajor, source: "mojang-metadata", note };
  }
  if (opts.packMajor && opts.packMajor >= 8) {
    return {
      major: opts.packMajor,
      source: "pack",
      note: `The pack publishes Java ${opts.packMajor}. Mojang metadata for this exact version was not available.`,
    };
  }
  return table;
}
