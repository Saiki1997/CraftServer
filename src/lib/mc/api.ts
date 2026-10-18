import { createServerFn } from "@tanstack/react-start";
import {
  finalizeLocal,
  inspectUrl,
  latestModrinthVersion,
  modrinthModVersions,
  resolveModBundle,
  resolvePlan,
  searchModrinth,
} from "./remote.ts";
import type { LoaderKind } from "./types.ts";

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") throw new Error("Invalid request.");
  return input as Record<string, unknown>;
}

function str(input: Record<string, unknown>, key: string, max: number): string {
  const value = input[key];
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export const inspectPackUrl = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asObject(input);
    const url = str(data, "url", 2000);
    if (url.length < 8) throw new Error("Enter a modpack URL.");
    return {
      url,
      curseforgeKey: str(data, "curseforgeKey", 200),
      allowUnlisted: data.allowUnlisted === true,
    };
  })
  .handler(async ({ data }) => inspectUrl(data.url, data));

export const resolveServerPlan = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asObject(input);
    const minecraftVersion = str(data, "minecraftVersion", 32);
    const loaderVersion = str(data, "loaderVersion", 64);
    const loader = str(data, "loader", 32) as LoaderKind;
    const allowed: LoaderKind[] = ["forge", "neoforge", "fabric", "quilt", "vanilla", "legacy-fabric", "unknown"];
    if (!allowed.includes(loader)) throw new Error("Unknown loader.");
    if (!minecraftVersion) throw new Error("Minecraft version is missing.");
    const packJava = typeof data.packJava === "number" ? data.packJava : undefined;
    return { minecraftVersion, loader, loaderVersion, packJava };
  })
  .handler(async ({ data }) => resolvePlan(data));

export const searchPacks = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asObject(input);
    const query = str(data, "query", 80);
    if (query.length < 2) throw new Error("Type at least 2 characters.");
    const projectType = data.projectType === "mod" ? "mod" : "modpack";
    return { query, projectType, loader: str(data, "loader", 32), version: str(data, "version", 32) } as const;
  })
  .handler(async ({ data }) => searchModrinth(data.query, data.projectType, { loader: data.loader, version: data.version }));

export const checkPackUpdate = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asObject(input);
    const projectId = str(data, "projectId", 64);
    if (!projectId) throw new Error("This server has no Modrinth project id.");
    return { projectId, currentId: str(data, "currentId", 64) };
  })
  .handler(async ({ data }) => latestModrinthVersion(data.projectId, data.currentId));

export const lookupMod = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asObject(input);
    const slug = str(data, "slug", 80);
    if (!slug) throw new Error("Enter a Modrinth slug.");
    return { slug };
  })
  .handler(async ({ data }) => modrinthModVersions(data.slug));

export const installModBundle = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asObject(input);
    const slug = str(data, "slug", 80).replace(/^https:\/\/modrinth.com\/mod\//, "").split(/[/?#]/)[0];
    const loader = str(data, "loader", 32);
    const minecraftVersion = str(data, "minecraftVersion", 32);
    if (!slug) throw new Error("Enter a Modrinth mod slug.");
    if (!loader || !minecraftVersion) throw new Error("This server has no loader or Minecraft version.");
    return { slug, loader, minecraftVersion };
  })
  .handler(async ({ data }) => resolveModBundle(data.slug, data.loader, data.minecraftVersion));

export const finalizeZipMeta = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asObject(input);
    const filename = str(data, "filename", 180) || "pack.zip";
    const indexJson = typeof data.indexJson === "string" ? data.indexJson.slice(0, 2_000_000) : "";
    const manifestJson = typeof data.manifestJson === "string" ? data.manifestJson.slice(0, 2_000_000) : "";
    if (!indexJson && !manifestJson) throw new Error("No pack index was found in that archive.");
    return { filename, indexJson, manifestJson, curseforgeKey: str(data, "curseforgeKey", 200) };
  })
  .handler(async ({ data }) =>
    finalizeLocal({
      filename: data.filename,
      indexJson: data.indexJson || undefined,
      manifestJson: data.manifestJson || undefined,
      curseforgeKey: data.curseforgeKey || undefined,
    }),
  );
