import type { FileSide, LoaderKind, PackFile } from "./types.ts";

export function safeRelPath(path: string): string | null {
  const norm = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!norm || norm.startsWith("/") || norm.split("/").some((p) => p === ".." || p === "")) return null;
  return norm;
}

export function sideFromEnv(client?: string, server?: string): {
  side: FileSide;
  clientOnly: boolean;
  serverOnly: boolean;
  uncertain: boolean;
  required: boolean;
} {
  const c = client ?? "unknown";
  const s = server ?? "unknown";
  const clientOnly = s === "unsupported" && c !== "unsupported";
  const serverOnly = c === "unsupported" && s !== "unsupported";
  const uncertain = s === "unknown" || s === "";
  let side: FileSide = "unknown";
  if (clientOnly) side = "client";
  else if (serverOnly) side = "server";
  else if (s === "required" || s === "optional") side = c === "unsupported" ? "server" : "both";
  return {
    side,
    clientOnly,
    serverOnly,
    uncertain: uncertain && !clientOnly,
    required: s === "required" || (s !== "unsupported" && s !== "optional" && !uncertain),
  };
}

export function fileFromModrinth(entry: {
  path: string;
  downloads?: string[];
  hashes?: { sha1?: string; sha512?: string };
  fileSize?: number;
  env?: { client?: string; server?: string };
}): PackFile | null {
  const path = safeRelPath(entry.path);
  if (!path) return null;
  const flags = sideFromEnv(entry.env?.client, entry.env?.server);
  return {
    path,
    url: entry.downloads?.find((u) => u.startsWith("https://")),
    sha1: entry.hashes?.sha1,
    sha512: entry.hashes?.sha512,
    size: entry.fileSize,
    ...flags,
    included: !flags.clientOnly,
  };
}

export function loaderFromDeps(deps: Record<string, string> | undefined, fallback: string[]): {
  loader: LoaderKind;
  version: string;
} {
  const d = deps ?? {};
  if (d["neoforge"]) return { loader: "neoforge", version: d["neoforge"] };
  if (d["forge"]) return { loader: "forge", version: d["forge"] };
  if (d["quilt-loader"]) return { loader: "quilt", version: d["quilt-loader"] };
  if (d["fabric-loader"]) return { loader: "fabric", version: d["fabric-loader"] };
  const loaders = fallback.map((l) => l.toLowerCase());
  if (loaders.includes("neoforge")) return { loader: "neoforge", version: "" };
  if (loaders.includes("forge")) return { loader: "forge", version: "" };
  if (loaders.includes("quilt")) return { loader: "quilt", version: "" };
  if (loaders.includes("fabric")) return { loader: "fabric", version: "" };
  return { loader: "unknown", version: "" };
}

export function parseLoaderId(id: string): { loader: LoaderKind; version: string } {
  const lower = id.toLowerCase();
  const version = id.includes("-") ? id.slice(id.indexOf("-") + 1) : "";
  if (lower.startsWith("neoforge")) return { loader: "neoforge", version };
  if (lower.startsWith("forge")) return { loader: "forge", version };
  if (lower.startsWith("quilt")) return { loader: "quilt", version };
  if (lower.startsWith("legacyfabric") || lower.startsWith("legacy-fabric")) {
    return { loader: "legacy-fabric", version };
  }
  if (lower.startsWith("fabric")) return { loader: "fabric", version };
  return { loader: "unknown", version: id };
}

export function emptyCounts(files: PackFile[]) {
  const mods = files.filter((f) => f.path.startsWith("mods/") && f.path.endsWith(".jar"));
  return {
    total: files.length,
    mods: mods.length,
    included: files.filter((f) => f.included).length,
    clientOnly: files.filter((f) => f.clientOnly).length,
    uncertain: files.filter((f) => f.uncertain && f.included).length,
    serverOnly: files.filter((f) => f.serverOnly).length,
  };
}
