import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useCraft } from "@/lib/mc/store";
import { cn } from "@/lib/utils";

const LOADERS = ["any", "fabric", "neoforge", "forge", "quilt", "vanilla"] as const;

export function ServersPage() {
  const servers = useCraft((s) => s.servers);
  const [query, setQuery] = useState("");
  const [loader, setLoader] = useState<(typeof LOADERS)[number]>("any");
  const versions = useMemo(() => ["any", ...new Set(servers.map((s) => s.minecraftVersion))], [servers]);
  const [version, setVersion] = useState("any");
  const shown = servers.filter((server) => {
    const q = query.trim().toLowerCase();
    if (q && !`${server.name} ${server.loader} ${server.minecraftVersion}`.toLowerCase().includes(q)) return false;
    if (loader !== "any" && server.loader !== loader) return false;
    if (version !== "any" && server.minecraftVersion !== version) return false;
    return true;
  });
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-display">Servers</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">Each instance keeps its own Java, mods, and properties. Download the folder and start it on your computer.</p>
        </div>
        <Link to="/create">
          <Button variant="primary">Install a pack</Button>
        </Link>
      </header>
      <div className="flex flex-col gap-3">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter servers" aria-label="Filter servers" />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Loader">
          {LOADERS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setLoader(item)}
              className={cn("h-11 rounded-full px-3 text-sm capitalize transition-colors duration-150", loader === item ? "bg-accent text-accent-foreground" : "bg-secondary text-muted")}
            >
              {item}
            </button>
          ))}
        </div>
        {versions.length > 1 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Minecraft version">
            {versions.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setVersion(item)}
                className={cn("h-11 rounded-full px-3 text-sm tabular-nums transition-colors duration-150", version === item ? "bg-accent text-accent-foreground" : "bg-secondary text-muted")}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {servers.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted">No servers saved in this browser yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">No servers match that name, loader, or version.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((server) => (
            <Link key={server.id} to="/servers/$serverId" params={{ serverId: server.id }} className="craft-rise rounded-xl border border-border bg-card p-4 transition-[transform,background-color] duration-150 hover:-translate-y-0.5 hover:bg-secondary">
              <div className="flex gap-3">
                {server.pack.iconUrl ? (
                  <img src={server.pack.iconUrl} alt="" className="size-14 rounded-md object-cover" />
                ) : (
                  <div className="flex size-14 items-center justify-center rounded-md bg-secondary text-sm font-medium">
                    {server.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-lg font-medium tracking-tight">{server.name}</div>
                  <div className="mt-1 text-sm text-muted">
                    {server.minecraftVersion} · {server.loader} {server.loaderVersion}
                  </div>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted">Status</dt>
                  <dd className="capitalize">{server.installedAt ? server.status : "not verified"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Java</dt>
                  <dd className="tabular-nums">{server.javaMajor}</dd>
                </div>
                <div>
                  <dt className="text-muted">RAM</dt>
                  <dd className="tabular-nums">{server.ramMinMb}–{server.ramMaxMb} MB</dd>
                </div>
                <div>
                  <dt className="text-muted">Port</dt>
                  <dd className="tabular-nums">{server.port}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}