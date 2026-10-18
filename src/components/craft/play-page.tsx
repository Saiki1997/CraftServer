import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useCraft } from "@/lib/mc/store";
import { cn } from "@/lib/utils";

const LOADERS = ["any", "fabric", "neoforge", "forge", "quilt", "vanilla"] as const;

export function PlayPage() {
  const plays = useCraft((s) => s.plays ?? []);
  const [query, setQuery] = useState("");
  const [loader, setLoader] = useState<(typeof LOADERS)[number]>("any");
  const versions = useMemo(() => ["any", ...new Set(plays.map((p) => p.minecraftVersion))], [plays]);
  const [version, setVersion] = useState("any");
  const shown = plays.filter((play) => {
    const q = query.trim().toLowerCase();
    if (q && !`${play.name} ${play.loader} ${play.minecraftVersion}`.toLowerCase().includes(q)) return false;
    if (loader !== "any" && play.loader !== loader) return false;
    if (version !== "any" && play.minecraftVersion !== version) return false;
    return true;
  });
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-display">Play</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">Client instances keep their own mods, Java, and window size. The game still starts on your computer, with an account you own.</p>
        </div>
        <Link to="/create">
          <Button variant="primary">Install a pack</Button>
        </Link>
      </header>
      <div className="flex flex-col gap-3">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter instances" aria-label="Filter instances" />
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
      {plays.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted">No play instances yet. Install a pack and choose Play.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">No instances match that name, loader, or version.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((play) => (
            <Link key={play.id} to="/play/$playId" params={{ playId: play.id }} className="craft-rise rounded-xl border border-border bg-card p-4 transition-[transform,background-color] duration-150 hover:-translate-y-0.5 hover:bg-secondary">
              <div className="flex gap-3">
                {play.pack.iconUrl ? (
                  <img src={play.pack.iconUrl} alt="" className="size-14 rounded-md object-cover" />
                ) : (
                  <div className="flex size-14 items-center justify-center rounded-md bg-secondary text-sm font-medium">{play.name.slice(0, 1).toUpperCase()}</div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-lg font-medium tracking-tight">{play.name}</div>
                  <div className="text-sm text-muted">{play.minecraftVersion} · {play.loader} · Java {play.javaMajor}</div>
                  <div className="mt-1 text-xs text-muted">{play.installedAt ? "Ready to download" : "Installing"}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
