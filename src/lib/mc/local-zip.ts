import { finalizeZipMeta } from "./api.ts";
import { inspectZipBuffer } from "./zip-cd.ts";

export async function importLocalZip(file: File, curseforgeKey: string) {
  if (file.size > 180_000_000) throw new Error("That archive is over 180 MB. Export a pack index instead of a full client instance.");
  const buf = new Uint8Array(await file.arrayBuffer());
  const zip = inspectZipBuffer(buf, ["modrinth.index.json", "manifest.json"]);
  const index = zip.files["modrinth.index.json"];
  const manifest = zip.files["manifest.json"];
  if (!index && !manifest) {
    throw new Error("No modrinth.index.json or CurseForge manifest.json was found. The archive was not modified.");
  }
  const decode = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : "");
  return finalizeZipMeta({
    data: {
      filename: file.name,
      indexJson: decode(index),
      manifestJson: decode(manifest),
      curseforgeKey,
    },
  });
}
