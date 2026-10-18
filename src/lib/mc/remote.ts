import { fileFromModrinth, loaderFromDeps, parseLoaderId, safeRelPath } from "./classify.ts";
import { fetchChecked, getJson, readRemoteZip, type ZipHit } from "./http.ts";
import { chooseJava, parseJavaMajor } from "./java.ts";
import type { DetectedPack, FileSide, InstallPlan, LoaderKind, PackFile, RuntimeAsset } from "./types.ts";
import { classifyUrl, type UrlKind } from "./url.ts";

function text(buf: Uint8Array | undefined): string {
  return buf ? new TextDecoder().decode(buf) : "";
}

function excerpt(s: string | undefined, n = 280): string {
  const clean = (s ?? "").replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}

async function mojangJava(version: string): Promise<{ major?: number; vanilla?: RuntimeAsset }> {
  try {
    const manifest = await getJson<{ versions: { id: string; url: string }[] }>(
      "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
    );
    const hit = manifest.versions.find((v) => v.id === version);
    if (!hit) return {};
    const meta = await getJson<{
      javaVersion?: { majorVersion?: number };
      downloads?: { server?: { url: string; sha1: string; size: number } };
    }>(hit.url);
    const server = meta.downloads?.server;
    return {
      major: meta.javaVersion?.majorVersion,
      vanilla: server
        ? { url: server.url, filename: "server.jar", checksum: server.sha1, size: server.size }
        : undefined,
    };
  } catch {
    return {};
  }
}

async function withJava(
  partial: Omit<DetectedPack, "javaMajor" | "javaSource" | "javaNote"> & { packJava?: number },
): Promise<DetectedPack> {
  const mojang = partial.minecraftVersion && partial.minecraftVersion !== "unknown" ? await mojangJava(partial.minecraftVersion) : {};
  const chosen = chooseJava({
    version: partial.minecraftVersion,
    loader: partial.loader,
    mojangMajor: mojang.major,
    packMajor: partial.packJava,
  });
  const { packJava: _drop, ...rest } = partial;
  void _drop;
  return { ...rest, javaMajor: chosen.major, javaSource: chosen.source, javaNote: chosen.note };
}

export async function inspectUrl(
  raw: string,
  opts: { curseforgeKey?: string; allowUnlisted?: boolean },
): Promise<DetectedPack> {
  const kind = classifyUrl(raw);
  if (kind.type === "unknown") throw new Error(kind.reason);
  if (kind.type === "modrinth") return inspectModrinth(kind.slug, kind.version);
  if (kind.type === "curseforge") return inspectCurseForge(kind, opts.curseforgeKey);
  if (kind.type === "ftb") return inspectFtb(kind.id);
  if (kind.type === "technic") return inspectTechnic(kind.slug);
  if (kind.type === "atlauncher") return inspectAtl(kind.slug);
  if (kind.type === "github") return inspectGithub(kind);
  return inspectDirect(kind.url, opts.allowUnlisted === true);
}

type MrFile = {
  path: string;
  downloads?: string[];
  hashes?: { sha1?: string; sha512?: string };
  fileSize?: number;
  env?: { client?: string; server?: string };
};

async function inspectModrinth(slug: string, versionHint?: string): Promise<DetectedPack> {
  const project = await getJson<{
    id: string;
    slug: string;
    title: string;
    description: string;
    project_type: string;
    icon_url?: string;
  }>(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}`);
  if (project.project_type !== "modpack") {
    throw new Error(`"${project.title}" is a ${project.project_type}, not a modpack.`);
  }
  let author = "";
  try {
    const members = await getJson<Array<{ role: string; user: { username: string } }>>(
      `https://api.modrinth.com/v2/project/${project.id}/members`,
    );
    author = members.find((m) => m.role === "Owner")?.user.username ?? members[0]?.user.username ?? "";
  } catch {
    author = "";
  }
  const versions = await getJson<
    Array<{
      id: string;
      version_number: string;
      version_type: string;
      game_versions: string[];
      loaders: string[];
      files: Array<{ url: string; filename: string; primary: boolean; size: number }>;
    }>
  >(`https://api.modrinth.com/v2/project/${project.id}/version`);
  if (!versions.length) throw new Error("Modrinth returned no files for this pack.");
  const chosen =
    versions.find((v) => v.id === versionHint || v.version_number === versionHint) ??
    versions.find((v) => v.version_type === "release") ??
    versions[0];
  const mr =
    chosen.files.find((f) => f.filename.endsWith(".mrpack") && f.primary) ??
    chosen.files.find((f) => f.filename.endsWith(".mrpack"));
  const serverZip = chosen.files.find(
    (f) => /server/i.test(f.filename) && f.filename.endsWith(".zip") && f !== mr,
  );
  if (!mr && !serverZip) throw new Error("This version has no .mrpack or server archive.");
  const warnings: string[] = [];
  let files: PackFile[] = [];
  let mc = chosen.game_versions[0] ?? "";
  let loader = loaderFromDeps(undefined, chosen.loaders);
  let archiveUrl: string | undefined;
  let official = false;
  let note =
    "No separate server pack was published. Files come from the Modrinth index env.server flags. Unknown sides stay included.";
  let mode: DetectedPack["installMode"] = "metadata-files";
  if (serverZip) {
    official = true;
    mode = "server-pack";
    archiveUrl = serverZip.url;
    note = `Official server archive: ${serverZip.filename}. The install script downloads and extracts that file.`;
    try {
      files = namesToContained((await readRemoteZip(serverZip.url, [], true)).names);
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : "Could not list the server archive.");
    }
  }
  if (mr && !official) {
    const zip = await readRemoteZip(mr.url, ["modrinth.index.json"], true);
    const index = JSON.parse(text(zip.files["modrinth.index.json"]) || "{}") as {
      versionId?: string;
      dependencies?: Record<string, string>;
      files?: MrFile[];
    };
    if (!index.files) throw new Error("modrinth.index.json is missing or invalid.");
    mc = index.dependencies?.minecraft || index.versionId || mc;
    loader = loaderFromDeps(index.dependencies, chosen.loaders);
    files = index.files.map(fileFromModrinth).filter((f): f is PackFile => Boolean(f));
    for (const name of zip.names.filter((n) => n.startsWith("overrides/") && !n.endsWith("/"))) {
      const rel = safeRelPath(name.slice("overrides/".length));
      if (!rel || files.some((f) => f.path === rel)) continue;
      files.push({
        path: rel,
        side: "both",
        required: true,
        clientOnly: false,
        serverOnly: false,
        uncertain: true,
        included: !rel.startsWith("resourcepacks/") && rel !== "options.txt",
        note: "Packed override. Included unless it is a client options file. The original archive is not modified.",
      });
    }
  }
  if (loader.loader === "unknown") warnings.push("Mod loader was not in the index dependencies.");
  return withJava({
    source: "modrinth",
    sourceLabel: "Modrinth",
    name: project.title,
    author,
    summary: excerpt(project.description),
    version: chosen.version_number,
    iconUrl: project.icon_url,
    pageUrl: `https://modrinth.com/modpack/${project.slug}/version/${chosen.id}`,
    minecraftVersion: mc || "unknown",
    loader: loader.loader,
    loaderVersion: loader.version,
    officialServerPack: official,
    serverPackNote: note,
    installMode: mode,
    files,
    warnings,
    sourceRef: {
      provider: "modrinth",
      projectId: project.id,
      versionId: chosen.id,
      slug: project.slug,
      pageUrl: `https://modrinth.com/modpack/${project.slug}`,
    },
    archiveUrl,
  });
}

function namesToContained(names: string[]): PackFile[] {
  return names.filter((n) => safeRelPath(n)).map((path) => ({
    path,
    side: "both" as FileSide,
    required: true,
    clientOnly: false,
    serverOnly: false,
    uncertain: !path.startsWith("mods/"),
    included: path.startsWith("mods/") || path.startsWith("config/") || path.endsWith(".jar"),
    contained: true,
    note: "Inside the server pack archive.",
  }));
}

type CfFile = {
  id: number;
  displayName: string;
  fileName: string;
  downloadUrl?: string | null;
  fileDate: string;
  serverPackFileId?: number | null;
  hashes?: Array<{ algo: number; value: string }>;
  gameVersions?: string[];
  fileLength?: number;
};

async function curseGet<T>(url: string, key: string): Promise<T> {
  return getJson<T>(url, { "x-api-key": key, Accept: "application/json" });
}

async function inspectCurseForge(kind: Extract<UrlKind, { type: "curseforge" }>, key?: string): Promise<DetectedPack> {
  if (!key) {
    const search = await getJson<{
      hits: Array<{ slug: string; title: string }>;
    }>(
      `https://api.modrinth.com/v2/search?limit=5&query=${encodeURIComponent(kind.slug.replace(/-/g, " "))}&facets=${encodeURIComponent('[["project_type:modpack"]]')}`,
    );
    const hit =
      search.hits.find((h) => h.slug === kind.slug) ??
      search.hits.find((h) => h.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") === kind.slug);
    if (!hit) {
      throw new Error(
        `CurseForge pack "${kind.slug}" needs an API key in Settings, or a CurseForge export ZIP. No exact Modrinth project matched this slug.`,
      );
    }
    const pack = await inspectModrinth(hit.slug);
    pack.warnings.unshift(
      `No CurseForge API key is saved. Loaded Modrinth project "${hit.title}" because the slug matched. Confirm it is the same pack.`,
    );
    return pack;
  }
  const search = await curseGet<{
    data: Array<{ id: number; name: string; slug: string; summary: string; logo?: { url?: string }; authors?: Array<{ name: string }> }>;
  }>(`https://api.curseforge.com/v1/mods/search?gameId=432&classId=4471&slug=${encodeURIComponent(kind.slug)}&pageSize=5`, key);
  const mod = search.data?.find((m) => m.slug === kind.slug) ?? search.data?.[0];
  if (!mod) throw new Error("CurseForge did not return that modpack. Check the slug and API key.");
  const listed = await curseGet<{ data: CfFile[] }>(`https://api.curseforge.com/v1/mods/${mod.id}/files?pageSize=50`, key);
  const file =
    (kind.fileId ? listed.data.find((f) => f.id === kind.fileId) : undefined) ??
    [...(listed.data ?? [])].sort((a, b) => +new Date(b.fileDate) - +new Date(a.fileDate))[0];
  if (!file) throw new Error("CurseForge returned no files for this pack.");
  const warnings: string[] = [];
  if (file.serverPackFileId) {
    const got = await curseGet<{ data: CfFile }>(`https://api.curseforge.com/v1/mods/${mod.id}/files/${file.serverPackFileId}`, key);
    if (got.data?.downloadUrl) {
      let names: string[] = [];
      try {
        names = (await readRemoteZip(got.data.downloadUrl, [], true)).names;
      } catch (err) {
        warnings.push(err instanceof Error ? err.message : "Could not list the CurseForge server pack.");
      }
      const mc = file.gameVersions?.find((g) => /^\d/.test(g)) ?? "unknown";
      return withJava({
        source: "curseforge",
        sourceLabel: "CurseForge",
        name: mod.name,
        author: mod.authors?.[0]?.name ?? "",
        summary: excerpt(mod.summary),
        version: file.displayName,
        iconUrl: mod.logo?.url,
        pageUrl: `https://www.curseforge.com/minecraft/modpacks/${mod.slug}/files/${file.id}`,
        minecraftVersion: mc,
        loader: "unknown",
        loaderVersion: "",
        officialServerPack: true,
        serverPackNote: `CurseForge published server pack file ${got.data.fileName}. Loader is not in that file id; set it before install if detection stays unknown.`,
        installMode: "server-pack",
        files: namesToContained(names),
        warnings,
        archiveUrl: got.data.downloadUrl,
        sourceRef: { provider: "curseforge", projectId: String(mod.id), versionId: String(file.id), slug: mod.slug },
      });
    }
  }
  if (!file.downloadUrl) throw new Error("CurseForge did not provide a download URL for this file.");
  const zip = await readRemoteZip(file.downloadUrl, ["manifest.json"], true);
  return manifestToPack(text(zip.files["manifest.json"]), {
    key,
    name: mod.name,
    summary: excerpt(mod.summary),
    iconUrl: mod.logo?.url,
    pageUrl: `https://www.curseforge.com/minecraft/modpacks/${mod.slug}/files/${file.id}`,
    projectId: String(mod.id),
    versionId: String(file.id),
    slug: mod.slug,
    authorFallback: mod.authors?.[0]?.name ?? "",
    source: "curseforge",
    sourceLabel: "CurseForge",
  });
}

async function manifestToPack(
  raw: string,
  meta: {
    key?: string;
    name: string;
    summary: string;
    iconUrl?: string;
    pageUrl?: string;
    projectId?: string;
    versionId?: string;
    slug?: string;
    authorFallback: string;
    source: DetectedPack["source"];
    sourceLabel: string;
  },
): Promise<DetectedPack> {
  const manifest = JSON.parse(raw || "{}") as {
    name?: string;
    version?: string;
    author?: string;
    minecraft?: { version?: string; modLoaders?: Array<{ id: string; primary?: boolean }> };
    files?: Array<{ projectID: number; fileID: number; required?: boolean }>;
  };
  if (!manifest.minecraft) throw new Error("The CurseForge archive has no manifest.json.");
  const primary = manifest.minecraft.modLoaders?.find((m) => m.primary) ?? manifest.minecraft.modLoaders?.[0];
  const parsed = primary ? parseLoaderId(primary.id) : { loader: "unknown" as LoaderKind, version: "" };
  const files: PackFile[] = [];
  const sha1s: string[] = [];
  if (meta.key && manifest.files?.length) {
    const resolved = new Map<number, CfFile>();
    for (let i = 0; i < manifest.files.length; i += 50) {
      const slice = manifest.files.slice(i, i + 50).map((f) => f.fileID);
      const res = await fetchChecked("https://api.curseforge.com/v1/mods/files", {
        method: "POST",
        headers: { "x-api-key": meta.key, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: slice }),
        maxBytes: 12_000_000,
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`CurseForge file lookup failed (${res.status}).`);
      const body = JSON.parse(new TextDecoder().decode(res.buf)) as { data: CfFile[] };
      for (const row of body.data ?? []) resolved.set(row.id, row);
    }
    for (const entry of manifest.files) {
      const row = resolved.get(entry.fileID);
      const sha1 = row?.hashes?.find((h) => h.algo === 1)?.value;
      if (sha1) sha1s.push(sha1);
      const path = safeRelPath(`mods/${row?.fileName ?? `cf-${entry.projectID}-${entry.fileID}.jar`}`);
      if (!path) continue;
      files.push({
        path,
        url: row?.downloadUrl ?? undefined,
        sha1,
        size: row?.fileLength,
        side: "unknown",
        required: entry.required !== false,
        clientOnly: false,
        serverOnly: false,
        uncertain: true,
        included: true,
        note: row?.downloadUrl ? "Side unknown until a hash match. Left included." : "No download URL from CurseForge.",
      });
    }
    await applyModrinthSides(files, sha1s);
  } else {
    for (const entry of manifest.files ?? []) {
      files.push({
        path: `mods/curseforge-${entry.projectID}-${entry.fileID}.jar`,
        side: "unknown",
        required: entry.required !== false,
        clientOnly: false,
        serverOnly: false,
        uncertain: true,
        included: true,
        note: `CurseForge project ${entry.projectID} file ${entry.fileID}. Add an API key and re-import to resolve downloads.`,
      });
    }
  }
  const warnings = [
    "No official server pack was selected. Mods with unknown side stay included.",
  ];
  if (!meta.key) warnings.push("Download URLs are not in manifest.json.");
  if (parsed.loader === "unknown") warnings.push("Manifest did not name a mod loader.");
  return withJava({
    source: meta.source,
    sourceLabel: meta.sourceLabel,
    name: manifest.name || meta.name,
    author: manifest.author || meta.authorFallback,
    summary: meta.summary,
    version: manifest.version || "unknown",
    iconUrl: meta.iconUrl,
    pageUrl: meta.pageUrl,
    minecraftVersion: manifest.minecraft.version || "unknown",
    loader: parsed.loader,
    loaderVersion: parsed.version,
    officialServerPack: false,
    serverPackNote:
      "No serverPackFileId. Client-only mods are excluded only when Modrinth hash data says the project is server-unsupported.",
    installMode: meta.key ? "metadata-files" : "manual",
    files,
    warnings,
    sourceRef: { provider: meta.source, projectId: meta.projectId, versionId: meta.versionId, slug: meta.slug, pageUrl: meta.pageUrl },
  });
}

async function applyModrinthSides(files: PackFile[], sha1s: string[]) {
  const unique = [...new Set(sha1s)].slice(0, 400);
  const byHash = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 50) {
    const slice = unique.slice(i, i + 50);
    try {
      const res = await fetchChecked("https://api.modrinth.com/v2/version_files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashes: slice, algorithm: "sha1" }),
        maxBytes: 8_000_000,
      });
      if (res.status < 200 || res.status >= 300) continue;
      const body = JSON.parse(new TextDecoder().decode(res.buf)) as Record<string, { project_id: string }>;
      for (const [hash, version] of Object.entries(body)) byHash.set(hash, version.project_id);
    } catch {
      /* best-effort */
    }
  }
  const ids = [...new Set(byHash.values())];
  const sides = new Map<string, { client_side: string; server_side: string }>();
  for (let i = 0; i < ids.length; i += 50) {
    const slice = ids.slice(i, i + 50);
    try {
      const projects = await getJson<Array<{ id: string; client_side: string; server_side: string }>>(
        `https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(slice))}`,
      );
      for (const p of projects) sides.set(p.id, p);
    } catch {
      /* ignore */
    }
  }
  for (const file of files) {
    if (!file.sha1) continue;
    const side = sides.get(byHash.get(file.sha1) ?? "");
    if (!side) continue;
    const clientOnly = side.server_side === "unsupported" && side.client_side !== "unsupported";
    file.clientOnly = clientOnly;
    file.serverOnly = side.client_side === "unsupported" && side.server_side !== "unsupported";
    file.uncertain = side.server_side === "unknown";
    file.side = clientOnly ? "client" : file.serverOnly ? "server" : side.server_side === "unknown" ? "unknown" : "both";
    file.included = !clientOnly;
    file.note = clientOnly ? "Modrinth marks this project server-unsupported." : "Side from Modrinth project metadata.";
  }
}

async function inspectFtb(id: number): Promise<DetectedPack> {
  const pack = await getJson<{
    id: number;
    name: string;
    synopsis?: string;
    art?: Array<{ url?: string }>;
    authors?: Array<{ name?: string }>;
    versions: Array<{ id: number; name: string; type: string; private?: boolean; targets?: Array<{ version: string; name: string; type: string }> }>;
  }>(`https://api.modpacks.ch/public/modpack/${id}`);
  const version =
    [...(pack.versions ?? [])].reverse().find((v) => !v.private && v.type === "release") ??
    [...(pack.versions ?? [])].reverse().find((v) => !v.private);
  if (!version) throw new Error("FTB published no public version for this pack.");
  const full = await getJson<{
    targets?: Array<{ version: string; name: string; type: string }>;
    files: Array<{
      path: string;
      url?: string;
      sha1?: string;
      size?: number;
      clientonly?: boolean;
      serveronly?: boolean;
      optional?: boolean;
      type?: string;
    }>;
  }>(`https://api.modpacks.ch/public/modpack/${id}/${version.id}`);
  const targets = full.targets ?? version.targets ?? [];
  const mc = targets.find((t) => t.type === "game" || t.name === "minecraft")?.version ?? "unknown";
  const loaderTarget = targets.find((t) => t.type === "modloader");
  const loaderName = (loaderTarget?.name ?? "").toLowerCase();
  const loader: LoaderKind = loaderName.includes("neoforge")
    ? "neoforge"
    : loaderName.includes("forge")
      ? "forge"
      : loaderName.includes("quilt")
        ? "quilt"
        : loaderName.includes("fabric")
          ? "fabric"
          : "unknown";
  const files: PackFile[] = [];
  for (const file of full.files ?? []) {
    const path = safeRelPath(file.path.replace(/^\.\//, ""));
    if (!path) continue;
    const clientOnly = Boolean(file.clientonly) && !file.serveronly;
    files.push({
      path,
      url: file.url,
      sha1: file.sha1,
      size: file.size,
      side: clientOnly ? "client" : file.serveronly ? "server" : "both",
      required: !file.optional,
      clientOnly,
      serverOnly: Boolean(file.serveronly) && !file.clientonly,
      uncertain: false,
      included: !clientOnly,
      note: file.type,
    });
  }
  return withJava({
    source: "ftb",
    sourceLabel: "FTB",
    name: pack.name,
    author: pack.authors?.[0]?.name ?? "FTB",
    summary: excerpt(pack.synopsis),
    version: version.name,
    iconUrl: pack.art?.find((a) => a.url)?.url,
    pageUrl: `https://www.feed-the-beast.com/modpacks/${id}`,
    minecraftVersion: mc,
    loader,
    loaderVersion: loaderTarget?.version ?? "",
    packJava: parseJavaMajor(targets.find((t) => t.type === "runtime" || t.name === "java")?.version),
    officialServerPack: false,
    serverPackNote: "FTB publishes one file list with clientonly flags. Those files are excluded. This is not a separate server zip.",
    installMode: "metadata-files",
    files,
    warnings: loader === "unknown" ? ["FTB did not name a mod loader target."] : [],
    sourceRef: { provider: "ftb", projectId: String(id), versionId: String(version.id) },
  });
}

async function inspectTechnic(slug: string): Promise<DetectedPack> {
  const pack = await getJson<{
    displayName?: string;
    name?: string;
    minecraft?: string;
    user?: string;
    description?: string;
    icon?: { url?: string };
    url?: string;
    isServer?: boolean;
    version?: string;
    solder?: string | null;
  }>(`https://api.technicpack.net/modpack/${encodeURIComponent(slug)}?build=latest`);
  const warnings = [
    "Technic does not publish a reliable dedicated server file list through this API. Nothing was guessed or removed.",
  ];
  if (pack.solder) warnings.push("This pack uses Solder. Import a server zip if you have one.");
  return withJava({
    source: "technic",
    sourceLabel: "Technic",
    name: pack.displayName || pack.name || slug,
    author: pack.user || "",
    summary: excerpt(pack.description),
    version: pack.version || "latest",
    iconUrl: pack.icon?.url,
    pageUrl: `https://www.technicpack.net/modpack/${slug}`,
    minecraftVersion: pack.minecraft || "unknown",
    loader: "unknown",
    loaderVersion: "",
    officialServerPack: Boolean(pack.isServer),
    serverPackNote: pack.isServer ? "Technic marked this build as a server, but file URLs were not inferred." : "No Technic server pack flag.",
    installMode: "manual",
    files: [],
    warnings,
    sourceRef: { provider: "technic", slug, pageUrl: pack.url },
  });
}

async function inspectAtl(slug: string): Promise<DetectedPack> {
  const res = await fetchChecked(`https://api.atlauncher.com/v1/pack/${encodeURIComponent(slug)}/`, { maxBytes: 4_000_000 });
  if (res.status === 404) throw new Error("ATLauncher has no pack with that name.");
  if (res.status < 200 || res.status >= 300) throw new Error(`ATLauncher request failed (${res.status}).`);
  const body = JSON.parse(new TextDecoder().decode(res.buf)) as {
    data?: {
      name?: string;
      safeName?: string;
      description?: string;
      versions?: Array<{ version: string; minecraft: string; loader?: { type?: string; version?: string }; isRecommended?: boolean }>;
    };
  };
  const data = body.data;
  if (!data) throw new Error("ATLauncher returned an empty pack.");
  const ver = data.versions?.find((v) => v.isRecommended) ?? data.versions?.[0];
  const loaderRaw = (ver?.loader?.type ?? "").toLowerCase();
  const loader: LoaderKind = loaderRaw.includes("neoforge")
    ? "neoforge"
    : loaderRaw.includes("forge")
      ? "forge"
      : loaderRaw.includes("quilt")
        ? "quilt"
        : loaderRaw.includes("fabric")
          ? "fabric"
          : "vanilla";
  return withJava({
    source: "atlauncher",
    sourceLabel: "ATLauncher",
    name: data.name || slug,
    author: "ATLauncher",
    summary: excerpt(data.description),
    version: ver?.version || "unknown",
    pageUrl: `https://atlauncher.com/pack/${data.safeName || slug}`,
    minecraftVersion: ver?.minecraft || "unknown",
    loader,
    loaderVersion: ver?.loader?.version || "",
    officialServerPack: false,
    serverPackNote: "Version metadata only. Import an exported zip for a file-level conversion.",
    installMode: "manual",
    files: [],
    warnings: ["ATLauncher file list was not downloaded."],
    sourceRef: { provider: "atlauncher", slug: data.safeName || slug, versionId: ver?.version },
  });
}

async function inspectGithub(kind: Extract<UrlKind, { type: "github" }>): Promise<DetectedPack> {
  const headers = { Accept: "application/vnd.github+json" };
  if (kind.assetName && kind.tag) {
    const url = `https://github.com/${kind.owner}/${kind.repo}/releases/download/${encodeURIComponent(kind.tag)}/${kind.assetName
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const pack = await inspectDirect(url, false);
    pack.source = "github";
    pack.sourceLabel = "GitHub";
    pack.sourceRef = {
      provider: "github",
      slug: `${kind.owner}/${kind.repo}`,
      versionId: kind.tag,
      pageUrl: `https://github.com/${kind.owner}/${kind.repo}`,
    };
    return pack;
  }
  const release = kind.tag
    ? await getJson<{ tag_name: string; body?: string; assets: Array<{ name: string; browser_download_url: string }> }>(
        `https://api.github.com/repos/${kind.owner}/${kind.repo}/releases/tags/${encodeURIComponent(kind.tag)}`,
        headers,
      )
    : await getJson<{ tag_name: string; body?: string; assets: Array<{ name: string; browser_download_url: string }> }>(
        `https://api.github.com/repos/${kind.owner}/${kind.repo}/releases/latest`,
        headers,
      );
  const assets = release.assets ?? [];
  const asset =
    assets.find((a) => a.name.endsWith(".mrpack")) ??
    assets.find((a) => /server/i.test(a.name) && a.name.endsWith(".zip")) ??
    assets.find((a) => a.name.endsWith(".zip"));
  if (!asset) throw new Error("The GitHub release has no .mrpack or .zip asset.");
  const pack = await inspectDirect(asset.browser_download_url, false);
  pack.version = release.tag_name || pack.version;
  pack.summary = pack.summary || excerpt(release.body);
  pack.source = "github";
  pack.sourceLabel = "GitHub";
  pack.pageUrl = `https://github.com/${kind.owner}/${kind.repo}/releases/tag/${release.tag_name}`;
  pack.sourceRef = { provider: "github", slug: `${kind.owner}/${kind.repo}`, versionId: release.tag_name, pageUrl: pack.pageUrl };
  if (assets.length > 1) pack.warnings.push(`Used asset ${asset.name}. Other release files were not imported.`);
  return pack;
}

export async function inspectDirect(url: string, allowUnlisted: boolean): Promise<DetectedPack> {
  const zip = await readRemoteZip(url, ["modrinth.index.json", "manifest.json"], allowUnlisted);
  return packFromZip(url, zip, "direct");
}

export function packFromZip(label: string, zip: ZipHit, source: DetectedPack["source"]): Promise<DetectedPack> {
  const indexRaw = text(zip.files["modrinth.index.json"]);
  if (indexRaw) {
    const index = JSON.parse(indexRaw) as {
      name?: string;
      versionId?: string;
      dependencies?: Record<string, string>;
      files?: MrFile[];
    };
    const deps = index.dependencies ?? {};
    const loader = loaderFromDeps(deps, []);
    const files = (index.files ?? []).map(fileFromModrinth).filter((f): f is PackFile => Boolean(f));
    return withJava({
      source: source === "direct" ? "zip" : source,
      sourceLabel: source === "github" ? "GitHub" : "ZIP",
      name: index.name || "Imported pack",
      author: "",
      summary: "Read from modrinth.index.json. The original archive is not modified.",
      version: deps.minecraft || index.versionId || "unknown",
      minecraftVersion: deps.minecraft || index.versionId || "unknown",
      loader: loader.loader,
      loaderVersion: loader.version,
      officialServerPack: false,
      serverPackNote: "No separate server pack inside this archive. Server files follow env.server. Unknown sides stay included.",
      installMode: "metadata-files",
      files,
      warnings: loader.loader === "unknown" ? ["Index did not name a loader."] : [],
      sourceRef: { provider: source === "direct" ? "zip" : source, pageUrl: label.startsWith("https://") ? label : undefined },
      pageUrl: label.startsWith("https://") ? label : undefined,
    });
  }
  const manifestRaw = text(zip.files["manifest.json"]);
  if (manifestRaw) {
    return manifestToPack(manifestRaw, {
      name: "CurseForge export",
      summary: "Read manifest.json. The original archive is not modified.",
      authorFallback: "",
      source: "zip",
      sourceLabel: "CurseForge ZIP",
    });
  }
  throw new Error("The archive has neither modrinth.index.json nor a CurseForge manifest.json.");
}

export async function finalizeLocal(input: {
  filename: string;
  indexJson?: string;
  manifestJson?: string;
  curseforgeKey?: string;
}): Promise<DetectedPack> {
  if (input.indexJson) {
    const bytes = new TextEncoder().encode(input.indexJson);
    return packFromZip(input.filename, { names: [], files: { "modrinth.index.json": bytes } }, "zip");
  }
  if (!input.manifestJson) throw new Error("The archive has neither modrinth.index.json nor manifest.json.");
  return manifestToPack(input.manifestJson, {
    key: input.curseforgeKey,
    name: input.filename,
    summary: input.curseforgeKey
      ? "CurseForge export resolved with your API key. The original archive was not modified."
      : "CurseForge export. Add an API key to resolve download URLs.",
    authorFallback: "",
    source: "zip",
    sourceLabel: "CurseForge ZIP",
  });
}

async function temurin(major: number, os: "windows" | "linux" | "mac"): Promise<RuntimeAsset | undefined> {
  try {
    const assets = await getJson<
      Array<{ binary: { package: { link: string; name: string; checksum?: string; size?: number } } }>
    >(
      `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&image_type=jre&os=${os}&vendor=eclipse`,
    );
    const pkg = assets[0]?.binary?.package;
    if (!pkg?.link) return undefined;
    return { url: pkg.link, filename: pkg.name, checksum: pkg.checksum, size: pkg.size };
  } catch {
    return undefined;
  }
}

async function loaderAsset(loader: LoaderKind, mc: string, version: string): Promise<{ url?: string; filename: string; note: string }> {
  if (loader === "vanilla") return { filename: "server.jar", note: "Vanilla uses the official server jar." };
  if (!version) return { filename: "", note: "Loader version is missing, so no installer URL was built." };
  if (loader === "fabric" || loader === "legacy-fabric") {
    try {
      const installers = await getJson<Array<{ version: string; stable: boolean }>>("https://meta.fabricmc.net/v2/versions/installer");
      const inst = installers.find((i) => i.stable)?.version ?? installers[0]?.version;
      if (!inst) throw new Error("Fabric published no installer.");
      const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(version)}/${encodeURIComponent(inst)}/server/jar`;
      const head = await fetchChecked(url, { headers: { Range: "bytes=0-0" }, maxBytes: 8 });
      if (head.status !== 200 && head.status !== 206) {
        return { filename: "fabric-server.jar", note: `Fabric meta did not return a server jar (${head.status}).` };
      }
      return { url, filename: "fabric-server.jar", note: `Official Fabric server jar for loader ${version}.` };
    } catch (err) {
      return { filename: "fabric-server.jar", note: err instanceof Error ? err.message : "Fabric metadata failed." };
    }
  }
  if (loader === "quilt") {
    try {
      await getJson(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(version)}/server/json`);
      const url = `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-loader/${encodeURIComponent(version)}/quilt-loader-${encodeURIComponent(version)}.jar`;
      return { url, filename: `quilt-loader-${version}.jar`, note: "Quilt loader jar from Quilt Maven. Libraries download on first launch." };
    } catch {
      return { filename: "quilt-server.jar", note: "Quilt metadata request failed." };
    }
  }
  if (loader === "neoforge") {
    const modern = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
    const legacy = `https://maven.neoforged.net/releases/net/neoforged/forge/${version}/forge-${version}-installer.jar`;
    for (const [url, filename, note] of [
      [modern, `neoforge-${version}-installer.jar`, "Official NeoForge installer. The script runs it with --installServer."],
      [legacy, `forge-${version}-installer.jar`, "NeoForge 1.20.1-era installer."],
    ] as const) {
      const head = await fetchChecked(url, { headers: { Range: "bytes=0-0" }, maxBytes: 8 }).catch(() => null);
      if (head && (head.status === 200 || head.status === 206)) return { url, filename, note };
    }
    return { filename: `neoforge-${version}-installer.jar`, note: "Neither NeoForge installer URL responded." };
  }
  if (loader === "forge") {
    const ver = version.startsWith(`${mc}-`) ? version : `${mc}-${version}`;
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${ver}/forge-${ver}-installer.jar`;
    const head = await fetchChecked(url, { headers: { Range: "bytes=0-0" }, maxBytes: 8 }).catch(() => null);
    if (head && (head.status === 200 || head.status === 206)) {
      return { url, filename: `forge-${ver}-installer.jar`, note: "Official Forge installer. The script runs it with --installServer." };
    }
    return { filename: `forge-${ver}-installer.jar`, note: `Forge installer did not respond (${head?.status ?? "network"}).` };
  }
  return { filename: "", note: "Unknown loader. No installer was selected." };
}

export async function resolvePlan(input: {
  minecraftVersion: string;
  loader: LoaderKind;
  loaderVersion: string;
  packJava?: number;
}): Promise<InstallPlan> {
  const mojang = await mojangJava(input.minecraftVersion);
  const chosen = chooseJava({
    version: input.minecraftVersion,
    loader: input.loader,
    mojangMajor: mojang.major,
    packMajor: input.packJava,
  });
  const [windows, linux, mac, loader] = await Promise.all([
    temurin(chosen.major, "windows"),
    temurin(chosen.major, "linux"),
    temurin(chosen.major, "mac"),
    loaderAsset(input.loader, input.minecraftVersion, input.loaderVersion),
  ]);
  if (!windows && !linux && !mac) throw new Error(`Adoptium did not return a Java ${chosen.major} build. ${chosen.note}`);
  if (input.loader !== "vanilla" && input.loader !== "unknown" && !loader.url) throw new Error(loader.note || "Loader installer could not be verified.");
  if ((input.loader === "vanilla" || input.loader === "fabric" || input.loader === "quilt") && input.loader === "vanilla" && !mojang.vanilla) {
    throw new Error("Mojang did not publish a server jar for this version.");
  }
  return {
    javaMajor: chosen.major,
    javaSource: chosen.source,
    javaNote: chosen.note,
    builds: { windows, linux, mac },
    loader,
    vanilla: mojang.vanilla,
    verifiedAt: Date.now(),
  };
}

export async function searchModrinth(
  query: string,
  projectType: "modpack" | "mod",
  filters?: { loader?: string; version?: string },
) {
  const facets: string[][] = [[`project_type:${projectType}`]];
  const loader = filters?.loader?.trim();
  const version = filters?.version?.trim();
  if (loader && loader !== "any") facets.push([`categories:${loader}`]);
  if (version && version !== "any") facets.push([`versions:${version}`]);
  const data = await getJson<{
    hits: Array<{ slug: string; title: string; author: string; description: string; icon_url?: string; downloads: number }>;
  }>(
    `https://api.modrinth.com/v2/search?limit=12&query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}`,
  );
  return (data.hits ?? []).map((h) => ({
    slug: h.slug,
    title: h.title,
    author: h.author,
    description: excerpt(h.description, 140),
    iconUrl: h.icon_url,
    downloads: h.downloads,
  }));
}

export async function latestModrinthVersion(projectId: string, currentId?: string) {
  const versions = await getJson<
    Array<{ id: string; version_number: string; version_type: string; game_versions: string[]; loaders: string[] }>
  >(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`);
  const latest = versions.find((v) => v.version_type === "release") ?? versions[0];
  if (!latest) throw new Error("No versions returned.");
  return {
    update: Boolean(currentId && latest.id !== currentId),
    id: latest.id,
    version: latest.version_number,
    minecraft: latest.game_versions[0] ?? "",
    loaders: latest.loaders,
  };
}

type MrVersion = {
  id: string;
  version_number: string;
  loaders: string[];
  game_versions: string[];
  dependencies?: Array<{ project_id?: string | null; dependency_type?: string }>;
  files: Array<{ url: string; filename: string; primary?: boolean; size?: number; hashes?: { sha1?: string; sha512?: string } }>;
};

function versionToFile(version: MrVersion, note: string): PackFile | null {
  const file = version.files.find((item) => item.primary) ?? version.files[0];
  if (!file?.url || !file.filename) return null;
  const safeName = file.filename.replace(/[^\w.+-]+/g, "_");
  return {
    path: safeRelPath(`mods/${file.filename}`) ?? `mods/${safeName}`,
    url: file.url,
    sha1: file.hashes?.sha1,
    sha512: file.hashes?.sha512,
    size: file.size,
    side: "unknown",
    required: true,
    clientOnly: false,
    serverOnly: false,
    uncertain: true,
    included: true,
    note,
  };
}

async function compatibleVersion(id: string, loader: string, minecraftVersion: string): Promise<MrVersion | null> {
  const params = new URLSearchParams();
  const loaderName = loader === "legacy-fabric" ? "fabric" : loader;
  if (loaderName && loaderName !== "vanilla" && loaderName !== "unknown") params.set("loaders", JSON.stringify([loaderName]));
  if (minecraftVersion) params.set("game_versions", JSON.stringify([minecraftVersion]));
  const versions = await getJson<MrVersion[]>(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(id)}/version?${params.toString()}`,
  );
  return versions[0] ?? null;
}

export async function resolveModBundle(slug: string, loader: string, minecraftVersion: string) {
  const root = await compatibleVersion(slug, loader, minecraftVersion);
  if (!root) throw new Error(`No ${loader} build of that mod for Minecraft ${minecraftVersion}.`);
  const project = await getJson<{ title?: string; slug?: string }>(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}`,
  );
  const title = project.title || slug;
  const rootFile = versionToFile(root, `Added from Modrinth. Matches ${loader} on ${minecraftVersion}.`);
  if (!rootFile) throw new Error("That version has no downloadable file.");
  const files: Array<{ title: string; file: PackFile }> = [{ title, file: rootFile }];
  const missing: string[] = [];
  const seen = new Set<string>([slug, project.slug ?? slug]);
  const required = (root.dependencies ?? []).filter((dep) => dep.dependency_type === "required" && dep.project_id);
  for (const dep of required) {
    if (files.length >= 8) break;
    const id = dep.project_id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const depProject = await getJson<{ title?: string; slug?: string }>(
        `https://api.modrinth.com/v2/project/${encodeURIComponent(id)}`,
      );
      if (depProject.slug) seen.add(depProject.slug);
      const version = await compatibleVersion(id, loader, minecraftVersion);
      const file = version ? versionToFile(version, `Required by ${title}.`) : null;
      if (!file) {
        missing.push(depProject.title || id);
        continue;
      }
      files.push({ title: depProject.title || id, file });
    } catch {
      missing.push(id);
    }
  }
  return { title, files, missing };
}

export async function modrinthModVersions(slug: string) {
  const versions = await getJson<
    Array<{
      id: string;
      version_number: string;
      loaders: string[];
      game_versions: string[];
      dependencies?: Array<{ project_id: string; dependency_type: string }>;
      files: Array<{ url: string; filename: string; primary: boolean; size: number; hashes: { sha1?: string; sha512?: string } }>;
    }>
  >(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}/version`);
  return versions.slice(0, 12).map((v) => {
    const file = v.files.find((f) => f.primary) ?? v.files[0];
    const safeName = file?.filename.replace(/[^\w.+-]+/g, "_") ?? "";
    const packFile: PackFile | null = file
      ? {
          path: safeRelPath(`mods/${file.filename}`) ?? `mods/${safeName}`,
          url: file.url,
          sha1: file.hashes?.sha1,
          sha512: file.hashes?.sha512,
          size: file.size,
          side: "unknown",
          required: true,
          clientOnly: false,
          serverOnly: false,
          uncertain: true,
          included: true,
          note: "Added from Modrinth. Side was not re-checked; review before installing.",
        }
      : null;
    return {
      id: v.id,
      version: v.version_number,
      loaders: v.loaders,
      gameVersions: v.game_versions,
      files: packFile ? [packFile] : [],
      deps: (v.dependencies ?? []).filter((d) => d.dependency_type === "required").map((d) => d.project_id),
    };
  });
}
