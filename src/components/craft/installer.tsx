import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { inspectPackUrl, searchPacks } from "@/lib/mc/api";
import { makeServer } from "@/lib/mc/factory";
import { runInstall } from "@/lib/mc/install";
import { importLocalZip } from "@/lib/mc/local-zip";
import { recommendRam } from "@/lib/mc/recommend";
import { useCraft } from "@/lib/mc/store";
import type { DetectedPack } from "@/lib/mc/types";
import { classifyUrl } from "@/lib/mc/url";
import { cn } from "@/lib/utils";

const FEATURED = [
  {
    title: "Simply Optimized Reloaded",
    meta: "NeoForge · 26.1",
    loader: "neoforge",
    version: "26.1",
    blurb: "Current light pack. Client-only mods stay off the server.",
    url: "https://modrinth.com/modpack/simply-optimized-reloaded",
    icon: "https://cdn.modrinth.com/data/Aa5L6RtV/2d323306d1e5909c81b3da0d57e9899383106f77_96.webp",
  },
  {
    title: "Vanilla Perfected",
    meta: "Fabric · 26.3",
    loader: "fabric",
    version: "26.3",
    blurb: "Vanilla-plus on the newest release.",
    url: "https://modrinth.com/modpack/vanilla-perfected",
    icon: "https://cdn.modrinth.com/data/1ocGzRHv/ebec737126db7637001194ca5560ae58413d338f_96.webp",
  },
  {
    title: "Cobblemon",
    meta: "Fabric · 1.21.1",
    loader: "fabric",
    version: "1.21.1",
    blurb: "Official Cobblemon pack for a shared world.",
    url: "https://modrinth.com/modpack/cobblemon-fabric",
    icon: "https://cdn.modrinth.com/data/5FFgwNNP/e7f9ee2e9d361623847853fe2ddce42f519ee64f.png",
  },
  {
    title: "Better MC Fabric",
    meta: "Fabric · 1.21",
    loader: "fabric",
    version: "1.21",
    blurb: "Larger pack. RAM is raised to match the mod count.",
    url: "https://modrinth.com/modpack/better-mc-fabric-bmc3",
    icon: "https://cdn.modrinth.com/data/NHUidpfR/327e0749bb6d160c41799fd77bf6d3d631569dc8_96.webp",
  },
] as const;

const LOADERS = ["any", "fabric", "neoforge", "forge", "quilt"] as const;
const VERSIONS = ["any", "26.3", "26.1", "1.21.1", "1.21", "1.20.1"] as const;
const STEPS = ["Read pack", "Java and loader", "Open server"] as const;

const SOURCE_LABEL: Record<string, string> = {
  modrinth: "Modrinth",
  curseforge: "CurseForge",
  ftb: "FTB",
  technic: "Technic",
  atlauncher: "ATLauncher",
  github: "GitHub",
  direct: "Direct file",
};

function stepIndex(phase: string) {
  if (phase.startsWith("Opening")) return 2;
  if (phase.startsWith("Choosing")) return 1;
  if (phase) return 0;
  return -1;
}

export function Installer({ heading = "page" }: { heading?: "home" | "page" }) {
  const navigate = useNavigate();
  const settings = useCraft((s) => s.settings);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [error, setError] = useState("");
  const [tune, setTune] = useState(false);
  const [drag, setDrag] = useState(false);
  const [name, setName] = useState("");
  const [port, setPort] = useState(25565);
  const [ramMin, setRamMin] = useState(0);
  const [ramMax, setRamMax] = useState(0);
  const [hits, setHits] = useState<Array<{ slug: string; title: string; author: string; description: string; iconUrl?: string; downloads: number }>>([]);
  const [packQuery, setPackQuery] = useState("");
  const [loaderFilter, setLoaderFilter] = useState<(typeof LOADERS)[number]>("any");
  const [versionFilter, setVersionFilter] = useState<(typeof VERSIONS)[number]>("any");
  const [picked, setPicked] = useState<string>(FEATURED[0].url);
  const [last, setLast] = useState<DetectedPack | null>(null);
  const kind = url.trim().length > 8 ? classifyUrl(url) : null;
  const source = kind && kind.type !== "unknown" ? SOURCE_LABEL[kind.type] : null;
  const step = stepIndex(phase);
  const shown = FEATURED.filter((pack) => {
    const q = packQuery.trim().toLowerCase();
    if (q && !`${pack.title} ${pack.blurb} ${pack.meta}`.toLowerCase().includes(q)) return false;
    if (loaderFilter !== "any" && pack.loader !== loaderFilter) return false;
    if (versionFilter !== "any" && pack.version !== versionFilter) return false;
    return true;
  });

  function searchCatalog(query: string, loader = loaderFilter, version = versionFilter) {
    const q = query.trim();
    if (q.length < 2 && loader === "any" && version === "any") return;
    setError("");
    void searchPacks({
      data: {
        query: q.length >= 2 ? q : loader === "any" ? "modpack" : loader,
        projectType: "modpack",
        loader,
        version,
      },
    })
      .then(setHits)
      .catch((err) => setError(err instanceof Error ? err.message : "Search failed."));
  }

  async function installPack(found: DetectedPack) {
    const ram = recommendRam(found.files, found.minecraftVersion);
    const server = makeServer(
      found,
      {
        name: name.trim() || found.name,
        port,
        ramMinMb: ramMin || ram.minMb,
        ramMaxMb: ramMax || ram.maxMb,
        excludeClient: true,
      },
      useCraft.getState().servers.map((s) => s.port),
    );
    useCraft.getState().addServer(server);
    useCraft.getState().pushActivity(`Installed ${server.name}`, server.id);
    setLast(found);
    setPhase("Opening the server");
    void runInstall(server.id);
    await navigate({ to: "/servers/$serverId", params: { serverId: server.id } });
  }

  async function installUrl(target: string) {
    const trimmed = target.trim();
    if (trimmed.length < 8) return;
    setUrl(trimmed);
    setPicked(trimmed);
    setActiveUrl(trimmed);
    setBusy(true);
    setError("");
    setPhase("Reading the modpack");
    try {
      const found = await inspectPackUrl({
        data: { url: trimmed, curseforgeKey: settings.curseforgeKey, allowUnlisted: settings.allowUnlistedHosts },
      });
      setPhase("Choosing Java and the loader");
      await installPack(found);
    } catch (err) {
      setPhase("");
      setActiveUrl("");
      setError(err instanceof Error ? err.message : "That link could not be installed.");
    } finally {
      setBusy(false);
    }
  }

  async function installFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setActiveUrl("zip");
    setPhase("Reading the archive");
    try {
      const found = await importLocalZip(file, settings.curseforgeKey);
      setPhase("Choosing Java and the loader");
      await installPack(found);
    } catch (err) {
      setPhase("");
      setActiveUrl("");
      setError(err instanceof Error ? err.message : "Could not read that ZIP.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid items-end gap-6 md:grid-cols-[1fr_240px]">
        <header>
          <img src="/mark.jpg" alt="" className="mb-4 h-36 w-full rounded-xl object-cover md:hidden" />
          <p className="text-sm text-muted">{heading === "home" ? "CraftServer" : "New server"}</p>
          <h1 className="mt-2 text-display">One click from a modpack to a server.</h1>
          <p className="mt-3 max-w-xl text-sm text-muted">
            Paste a link or pick a pack. Filter by loader and Minecraft version, then install.
          </p>
          <a
            href="https://github.com/Saiki1997/CraftServer/releases/download/v1.0.0/CraftServer-Windows.zip"
            className="mt-4 inline-flex h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground"
          >
            Download the Windows app
          </a>
        </header>
        <img src="/mark.jpg" alt="" className="hidden aspect-square w-full rounded-xl object-cover md:block" />
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void installUrl(url);
        }}
      >
        <div className="relative min-w-0 sm:flex-1">
          <Input
            id="pack-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a modpack link"
            aria-label="Modpack URL"
            autoComplete="off"
            className={source ? "pr-28" : undefined}
          />
          {source ? (
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-sm bg-secondary px-2 py-1 text-xs text-foreground">
              {source}
            </span>
          ) : null}
        </div>
        <Button variant="primary" type="submit" disabled={busy || url.trim().length < 8} className="sm:min-w-36">
          {busy && activeUrl === url.trim() ? "Installing…" : "Install"}
        </Button>
      </form>

      {step >= 0 ? (
        <ol className="grid grid-cols-3 gap-2" aria-label="Install progress">
          {STEPS.map((label, i) => (
            <li key={label} className="min-w-0">
              <div className={cn("h-1 rounded-full transition-[background-color] duration-150", i <= step ? "bg-accent" : "bg-secondary")} />
              <p className={cn("mt-2 truncate text-xs", i <= step ? "text-foreground" : "text-muted")}>{label}</p>
            </li>
          ))}
        </ol>
      ) : null}

      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3 text-sm transition-colors duration-150",
          drag ? "border-foreground bg-secondary" : "border-border",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void installFile(e.dataTransfer.files[0]);
        }}
      >
        <span className="text-muted">{drag ? "Drop the archive" : "Drop a .zip or .mrpack here"}</span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex h-11 cursor-pointer items-center rounded-md bg-secondary px-3">
            Choose a file
            <input className="sr-only" type="file" accept=".zip,.mrpack,application/zip" onChange={(e) => void installFile(e.target.files?.[0])} />
          </label>
          <button type="button" className="h-11 text-muted underline-offset-2 hover:text-foreground hover:underline" onClick={() => setTune((v) => !v)}>
            {tune ? "Hide options" : "Name, port, and RAM"}
          </button>
        </div>
      </div>

      {error ? <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-destructive">{error}</p> : null}

      {tune ? (
        <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="server-name">Server name</Label>
            <Input id="server-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Uses the pack name if empty" />
          </div>
          <div>
            <Label htmlFor="port">Port</Label>
            <Input id="port" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value) || 25565)} />
          </div>
          <div>
            <Label htmlFor="ram-min">Minimum RAM (MB)</Label>
            <Input id="ram-min" type="number" min={0} step={512} value={ramMin || ""} placeholder="Auto" onChange={(e) => setRamMin(Number(e.target.value) || 0)} />
          </div>
          <div>
            <Label htmlFor="ram-max">Maximum RAM (MB)</Label>
            <Input id="ram-max" type="number" min={0} step={512} value={ramMax || ""} placeholder="Auto" onChange={(e) => setRamMax(Number(e.target.value) || 0)} />
          </div>
          <p className="text-sm text-muted sm:col-span-2">Leave RAM blank and it follows the mod count. These choices apply to the next install.</p>
        </div>
      ) : null}

      <section>
        <h2 className="text-base font-medium">Find a pack</h2>
        <p className="mt-1 text-sm text-muted">Filter the shelf, or search Modrinth by name, loader, and version.</p>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            searchCatalog(packQuery);
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={packQuery} onChange={(e) => setPackQuery(e.target.value)} placeholder="Search packs" aria-label="Search packs" className="sm:flex-1" />
            <Button type="submit">Search</Button>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Mod loader">
            {LOADERS.map((loader) => (
              <button
                key={loader}
                type="button"
                onClick={() => {
                  setLoaderFilter(loader);
                  if (packQuery.trim().length >= 2 || versionFilter !== "any") searchCatalog(packQuery, loader, versionFilter);
                }}
                className={cn(
                  "h-11 rounded-full px-3 text-sm capitalize transition-colors duration-150",
                  loaderFilter === loader ? "bg-accent text-accent-foreground" : "bg-secondary text-muted hover:text-foreground",
                )}
              >
                {loader}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Minecraft version">
            {VERSIONS.map((version) => (
              <button
                key={version}
                type="button"
                onClick={() => {
                  setVersionFilter(version);
                  if (packQuery.trim().length >= 2 || loaderFilter !== "any") searchCatalog(packQuery, loaderFilter, version);
                }}
                className={cn(
                  "h-11 rounded-full px-3 text-sm tabular-nums transition-colors duration-150",
                  versionFilter === version ? "bg-accent text-accent-foreground" : "bg-secondary text-muted hover:text-foreground",
                )}
              >
                {version}
              </button>
            ))}
          </div>
        </form>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {shown.length === 0 ? <p className="text-sm text-muted">No shelf packs match. Search Modrinth for more.</p> : null}
          {shown.map((pack, index) => {
            const armed = picked === pack.url;
            const running = busy && activeUrl === pack.url;
            return (
              <article
                key={pack.url}
                className={cn(
                  "craft-rise group flex flex-col overflow-hidden rounded-xl border bg-card transition-[transform,border-color] duration-150",
                  armed ? "border-foreground" : "border-border hover:-translate-y-0.5",
                )}
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <button type="button" className="flex gap-3 p-4 text-left" onClick={() => { setPicked(pack.url); setUrl(pack.url); }}>
                  <img src={pack.icon} alt="" className="size-14 shrink-0 rounded-md object-cover transition-transform duration-150 group-hover:scale-105" />
                  <span className="min-w-0">
                    <span className="block font-mono text-xs text-muted">{pack.meta}</span>
                    <span className="mt-1 block text-lg font-medium tracking-tight">{pack.title}</span>
                    <span className="mt-1 block text-sm text-muted">{pack.blurb}</span>
                  </span>
                </button>
                <div className="px-4 pb-4">
                  <Button variant={armed ? "primary" : "secondary"} disabled={busy} onClick={() => void installUrl(pack.url)} className="w-full">
                    {running ? "Installing…" : armed ? "Install this pack" : "Install"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {hits.length > 0 ? (
        <ul className="craft-rise divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {hits.map((hit) => (
            <li key={hit.slug} className="flex flex-col gap-3 px-4 py-3 transition-colors duration-150 hover:bg-secondary sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                {hit.iconUrl ? <img src={hit.iconUrl} alt="" className="size-12 shrink-0 rounded-md object-cover" /> : <div className="size-12 shrink-0 rounded-md bg-secondary" />}
                <div className="min-w-0">
                  <div className="font-medium">{hit.title}</div>
                  <div className="text-xs text-muted">{hit.author} · {hit.downloads.toLocaleString()} downloads</div>
                  <div className="line-clamp-2 text-sm text-muted">{hit.description}</div>
                </div>
              </div>
              <Button className="shrink-0" variant="primary" size="sm" disabled={busy} onClick={() => void installUrl(`https://modrinth.com/modpack/${hit.slug}`)}>
                Install
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {last ? (
        <p className="text-sm text-muted">
          Last read: {last.name} · Minecraft {last.minecraftVersion} · {last.loader} {last.loaderVersion} · Java {last.javaMajor}
        </p>
      ) : null}
    </div>
  );
}
