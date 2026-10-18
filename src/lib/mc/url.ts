export type UrlKind =
  | { type: "modrinth"; slug: string; version?: string }
  | { type: "curseforge"; slug: string; fileId?: number }
  | { type: "ftb"; id: number }
  | { type: "technic"; slug: string }
  | { type: "atlauncher"; slug: string }
  | { type: "github"; owner: string; repo: string; tag?: string; assetName?: string }
  | { type: "direct"; url: string }
  | { type: "unknown"; reason: string };

const TRUSTED_SUFFIXES = [
  "modrinth.com",
  "modpacks.ch",
  "feed-the-beast.com",
  "technicpack.net",
  "atlauncher.com",
  "github.com",
  "githubusercontent.com",
  "mojang.com",
  "fabricmc.net",
  "quiltmc.org",
  "minecraftforge.net",
  "neoforged.net",
  "adoptium.net",
  "curseforge.com",
  "forgecdn.net",
];

export function hostTrusted(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return TRUSTED_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

export function assertPublicHttps(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http(s) URLs can be imported. The download itself must stay on https.");
  }
  if (url.username || url.password) throw new Error("URLs with embedded passwords are blocked.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    host === "metadata.google.internal"
  ) {
    throw new Error("Local and internal hosts are blocked.");
  }
  if (host.includes(":") || host.startsWith("[")) {
    throw new Error("IP-literal URLs are blocked.");
  }
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const n = ip.slice(1).map(Number);
    if (n.some((x) => x > 255)) throw new Error("That address is not valid.");
    const [a, b] = n;
    const priv =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
    if (priv) throw new Error("Private network URLs are blocked.");
  }
  if (url.protocol !== "https:") throw new Error("Downloads must use https.");
  return url;
}

export function classifyUrl(input: string): UrlKind {
  const trimmed = input.trim();
  if (!trimmed) return { type: "unknown", reason: "Paste a modpack URL." };
  let url: URL;
  try {
    url = assertPublicHttps(trimmed);
  } catch (err) {
    return { type: "unknown", reason: err instanceof Error ? err.message : "Invalid URL." };
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "modrinth.com" || host.endsWith(".modrinth.com")) {
    if (host === "cdn.modrinth.com" && url.pathname.toLowerCase().endsWith(".mrpack")) {
      return { type: "direct", url: url.toString() };
    }
    const kind = parts[0];
    const slug = parts[1];
    if ((kind === "modpack" || kind === "project" || kind === "mod") && slug) {
      const vIdx = parts.indexOf("version");
      const version = vIdx >= 0 ? decodeURIComponent(parts[vIdx + 1] ?? "") : undefined;
      return { type: "modrinth", slug: decodeURIComponent(slug), version: version || undefined };
    }
    return { type: "unknown", reason: "That Modrinth link is not a project or modpack page." };
  }

  if (host.endsWith("curseforge.com")) {
    const mp = parts.indexOf("modpacks");
    if (mp >= 0 && parts[mp + 1]) {
      const slug = decodeURIComponent(parts[mp + 1]);
      const files = parts.indexOf("files");
      const fileId = files >= 0 ? Number(parts[files + 1]) : undefined;
      return {
        type: "curseforge",
        slug,
        fileId: fileId && Number.isFinite(fileId) ? fileId : undefined,
      };
    }
    return { type: "unknown", reason: "Use a CurseForge modpack page, not a mod or home page." };
  }

  if (host.endsWith("feed-the-beast.com") || host.endsWith("modpacks.ch")) {
    const joined = parts.join("/");
    const idMatch = joined.match(/(?:modpacks|modpack)\/(\d+)/);
    if (idMatch) return { type: "ftb", id: Number(idMatch[1]) };
    return { type: "unknown", reason: "FTB links need a numeric modpack id, like /modpacks/119-name." };
  }

  if (host.endsWith("technicpack.net")) {
    const idx = parts.indexOf("modpack");
    const slug = idx >= 0 ? parts[idx + 1] : parts[0];
    if (!slug || slug === "modpack") return { type: "unknown", reason: "That Technic link has no pack slug." };
    return { type: "technic", slug: decodeURIComponent(slug).replace(/\.(\d+)$/, "") };
  }

  if (host.endsWith("atlauncher.com")) {
    const idx = parts.indexOf("pack");
    const slug = idx >= 0 ? parts[idx + 1] : "";
    if (!slug) return { type: "unknown", reason: "That ATLauncher link has no pack name." };
    return { type: "atlauncher", slug: decodeURIComponent(slug) };
  }

  if (host === "github.com") {
    const owner = parts[0];
    const repo = parts[1]?.replace(/\.git$/, "");
    if (!owner || !repo) return { type: "unknown", reason: "GitHub links need an owner and repository." };
    if (parts[2] === "releases" && parts[3] === "tag" && parts[4]) {
      return { type: "github", owner, repo, tag: decodeURIComponent(parts.slice(4).join("/")) };
    }
    if (parts[2] === "releases" && parts[3] === "download" && parts[4] && parts[5]) {
      return {
        type: "github",
        owner,
        repo,
        tag: decodeURIComponent(parts[4]),
        assetName: decodeURIComponent(parts.slice(5).join("/")),
      };
    }
    return { type: "github", owner, repo };
  }

  if (host === "objects.githubusercontent.com" || host.endsWith("githubusercontent.com")) {
    return { type: "direct", url: url.toString() };
  }

  if (/\.(mrpack|zip)$/i.test(url.pathname)) {
    return { type: "direct", url: url.toString() };
  }

  return {
    type: "unknown",
    reason: "No adapter matches that site. Supported: Modrinth, CurseForge, FTB, Technic, ATLauncher, GitHub releases, and direct .mrpack or .zip links.",
  };
}
