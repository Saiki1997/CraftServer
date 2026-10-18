import { inflateSync } from "fflate";
import { assertPublicHttps, hostTrusted } from "./url.ts";
import { extractEntry, findEocd, parseCentralDirectory, readEocd, safeZipName, type ZipEntry } from "./zip-cd.ts";

const UA = "CraftServer/1.0 (modpack-server-manager)";

export type ZipHit = { names: string[]; files: Record<string, Uint8Array> };

async function readBody(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Empty response.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error(`Response exceeded ${Math.round(max / 1_000_000)} MB.`);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.byteLength;
  }
  return buf;
}

export async function fetchChecked(
  url: string,
  init: RequestInit & { maxBytes?: number; allowUnlisted?: boolean } = {},
): Promise<{ buf: Uint8Array; finalUrl: string; status: number; headers: Headers }> {
  let current = assertPublicHttps(url).toString();
  const max = init.maxBytes ?? 4_000_000;
  for (let hop = 0; hop < 5; hop++) {
    const next = assertPublicHttps(current);
    if (!init.allowUnlisted && !hostTrusted(next.hostname)) {
      throw new Error(
        `${next.hostname} is not on the trusted download list. Enable unlisted hosts only if you trust this file.`,
      );
    }
    const headers = new Headers(init.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", UA);
    if (!headers.has("Accept-Encoding")) headers.set("Accept-Encoding", "identity");
    const res = await fetch(next, { ...init, headers, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Redirect had no location.");
      current = new URL(loc, next).toString();
      continue;
    }
    const buf = res.ok || res.status === 206 ? await readBody(res, max) : new Uint8Array();
    return { buf, finalUrl: next.toString(), status: res.status, headers: res.headers };
  }
  throw new Error("Too many redirects.");
}

export async function getJson<T>(url: string, headers?: HeadersInit): Promise<T> {
  const { buf, status } = await fetchChecked(url, { headers, maxBytes: 12_000_000 });
  if (status < 200 || status >= 300) throw new Error(`Request failed (${status}) for ${new URL(url).hostname}.`);
  try {
    return JSON.parse(new TextDecoder().decode(buf)) as T;
  } catch {
    throw new Error(`Invalid JSON from ${new URL(url).hostname}.`);
  }
}

async function rangeGet(url: string, start: number, end: number, allowUnlisted: boolean): Promise<Uint8Array> {
  if (end < start) return new Uint8Array();
  const { buf, status, headers } = await fetchChecked(url, {
    headers: { Range: `bytes=${start}-${end}` },
    maxBytes: end - start + 2048,
    allowUnlisted,
  });
  if (status !== 206 && status !== 200) throw new Error(`Could not read archive bytes (${status}).`);
  if (status === 200 && !headers.get("content-range")) {
    return buf.subarray(start, Math.min(buf.length, end + 1));
  }
  return buf;
}

export function inspectFull(file: Uint8Array, wanted: string[]): ZipHit {
  const eocd = findEocd(file);
  if (eocd < 0) throw new Error("This file is not a readable ZIP archive.");
  const { cdSize, cdOffset } = readEocd(file, eocd);
  const entries = parseCentralDirectory(file.subarray(cdOffset, cdOffset + cdSize));
  const names = entries.map((e) => e.name).filter((n) => safeZipName(n) && !n.endsWith("/"));
  const files: Record<string, Uint8Array> = {};
  for (const want of wanted) {
    const entry = entries.find((e) => e.name === want || e.name.endsWith(`/${want}`));
    if (!entry || entry.uncompSize > 8_000_000) continue;
    files[want] = extractEntry(file, entry);
  }
  return { names, files };
}

async function inflateRemote(url: string, entry: ZipEntry, allowUnlisted: boolean): Promise<Uint8Array> {
  if (!safeZipName(entry.name)) throw new Error(`Blocked unsafe archive path: ${entry.name}`);
  if (entry.uncompSize > 8_000_000) throw new Error(`${entry.name} is too large to parse.`);
  const head = await rangeGet(url, entry.localOffset, entry.localOffset + 29, allowUnlisted);
  const nameLen = head[26] | (head[27] << 8);
  const extraLen = head[28] | (head[29] << 8);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  if (entry.compSize === 0) return new Uint8Array();
  const data = await rangeGet(url, start, start + entry.compSize - 1, allowUnlisted);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateSync(data);
  throw new Error(`Unsupported compression for ${entry.name}.`);
}

export async function readRemoteZip(url: string, wanted: string[], allowUnlisted: boolean): Promise<ZipHit> {
  const probe = await fetchChecked(url, { headers: { Range: "bytes=0-0" }, maxBytes: 8, allowUnlisted });
  const cr = probe.headers.get("content-range");
  const total = cr?.match(/\/(\d+)$/)?.[1];
  const size = total ? Number(total) : Number(probe.headers.get("content-length") || 0);
  if (!size) throw new Error("The host did not report the archive size.");
  if (size > 400_000_000) throw new Error("Archive is over 400 MB. Import the file from disk instead.");
  if (size <= 28_000_000) {
    const { buf, status } = await fetchChecked(url, { maxBytes: 28_000_000, allowUnlisted });
    if (status < 200 || status >= 300) throw new Error(`Archive download failed (${status}).`);
    return inspectFull(buf, wanted);
  }
  const tailLen = Math.min(size, 65557);
  const tail = await rangeGet(url, size - tailLen, size - 1, allowUnlisted);
  const eocdRel = findEocd(tail);
  if (eocdRel < 0) throw new Error("Could not find the ZIP directory. The host may not support range requests.");
  const { cdSize, cdOffset } = readEocd(tail, eocdRel);
  const cd = await rangeGet(url, cdOffset, cdOffset + cdSize - 1, allowUnlisted);
  const entries = parseCentralDirectory(cd);
  const names = entries.map((e) => e.name).filter((n) => safeZipName(n) && !n.endsWith("/"));
  const files: Record<string, Uint8Array> = {};
  for (const want of wanted) {
    const entry = entries.find((e) => e.name === want || e.name.endsWith(`/${want}`));
    if (!entry) continue;
    files[want] = await inflateRemote(url, entry, allowUnlisted);
  }
  return { names, files };
}
