import { inflateSync } from "fflate";

export type ZipEntry = {
  name: string;
  method: number;
  compSize: number;
  uncompSize: number;
  localOffset: number;
};

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

export function findEocd(buf: Uint8Array): number {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      const commentLen = u16(buf, i + 20);
      if (i + 22 + commentLen === buf.length) return i;
    }
  }
  return -1;
}

export function readEocd(buf: Uint8Array, eocd: number): { cdSize: number; cdOffset: number; entries: number } {
  const cdSize = u32(buf, eocd + 12);
  const cdOffset = u32(buf, eocd + 16);
  const entries = u16(buf, eocd + 10);
  if (cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error("This archive uses ZIP64, which this installer cannot read safely.");
  }
  return { cdSize, cdOffset, entries };
}

export function parseCentralDirectory(cd: Uint8Array): ZipEntry[] {
  const out: ZipEntry[] = [];
  let o = 0;
  while (o + 46 <= cd.length) {
    if (u32(cd, o) !== 0x02014b50) break;
    const flags = u16(cd, o + 8);
    const method = u16(cd, o + 10);
    const compSize = u32(cd, o + 20);
    const uncompSize = u32(cd, o + 24);
    const nameLen = u16(cd, o + 28);
    const extraLen = u16(cd, o + 30);
    const commentLen = u16(cd, o + 32);
    const localOffset = u32(cd, o + 42);
    if (compSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("This archive uses ZIP64, which this installer cannot read safely.");
    }
    const nameBytes = cd.subarray(o + 46, o + 46 + nameLen);
    const name = new TextDecoder(flags & 0x800 ? "utf-8" : "utf-8", { fatal: false }).decode(nameBytes);
    out.push({ name: name.replace(/\\/g, "/"), method, compSize, uncompSize, localOffset });
    o += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function safeZipName(name: string): boolean {
  const n = name.replace(/\\/g, "/");
  if (!n || n.startsWith("/") || n.split("/").some((p) => p === "..")) return false;
  return true;
}

export function extractEntry(file: Uint8Array, entry: ZipEntry): Uint8Array {
  if (!safeZipName(entry.name)) throw new Error(`Blocked unsafe archive path: ${entry.name}`);
  if (entry.localOffset + 30 > file.length) throw new Error(`Truncated archive entry: ${entry.name}`);
  const nameLen = u16(file, entry.localOffset + 26);
  const extraLen = u16(file, entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const end = start + entry.compSize;
  if (end > file.length) throw new Error(`Truncated archive entry: ${entry.name}`);
  const data = file.subarray(start, end);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateSync(data);
  throw new Error(`Unsupported compression for ${entry.name}.`);
}

export function inspectZipBuffer(file: Uint8Array, wanted: string[]): {
  names: string[];
  files: Record<string, Uint8Array>;
} {
  const eocd = findEocd(file);
  if (eocd < 0) throw new Error("This file is not a readable ZIP archive.");
  const { cdSize, cdOffset } = readEocd(file, eocd);
  if (cdOffset + cdSize > file.length) throw new Error("ZIP directory is truncated.");
  const entries = parseCentralDirectory(file.subarray(cdOffset, cdOffset + cdSize));
  const names = entries.map((e) => e.name).filter((n) => safeZipName(n) && !n.endsWith("/"));
  const files: Record<string, Uint8Array> = {};
  for (const want of wanted) {
    const entry = entries.find((e) => e.name === want || e.name.endsWith(`/${want}`));
    if (!entry || entry.name.endsWith("/")) continue;
    if (entry.uncompSize > 8_000_000) throw new Error(`${entry.name} is too large to parse.`);
    files[want] = extractEntry(file, entry);
  }
  return { names, files };
}
