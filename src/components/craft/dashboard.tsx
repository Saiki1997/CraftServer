import { Link } from "@tanstack/react-router";
import { Installer } from "@/components/craft/installer";
import { useCraft } from "@/lib/mc/store";

export function Dashboard() {
  const servers = useCraft((s) => s.servers);
  const plays = useCraft((s) => s.plays ?? []);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12">
      <Installer heading="home" />
      <section>
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-base font-medium">Play</h2>
          <Link to="/play" className="text-sm text-muted hover:text-foreground">View all</Link>
        </div>
        {plays.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No client instances yet. Choose Play on a pack.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {plays.slice(0, 3).map((play) => (
              <li key={play.id}>
                <Link to="/play/$playId" params={{ playId: play.id }} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-150 hover:bg-secondary">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{play.name}</span>
                    <span className="block text-sm text-muted">{play.minecraftVersion} · {play.loader} · client mods kept</span>
                  </span>
                  <span className="text-sm text-muted">{play.installedAt ? "Ready" : "Installing"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-base font-medium">Host</h2>
          <Link to="/servers" className="text-sm text-muted hover:text-foreground">View all</Link>
        </div>
        {servers.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No servers yet. Choose Host on a pack. Client-only mods stay off the server.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {servers.slice(0, 4).map((server) => (
              <li key={server.id}>
                <Link to="/servers/$serverId" params={{ serverId: server.id }} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-150 hover:bg-secondary">
                  <span className="flex min-w-0 items-center gap-3">
                    {server.pack.iconUrl ? (
                      <img src={server.pack.iconUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" />
                    ) : (
                      <span className="size-10 shrink-0 rounded-md bg-secondary" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{server.name}</span>
                      <span className="block text-sm text-muted">
                        {server.minecraftVersion} · {server.loader} · Java {server.javaMajor}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-sm capitalize text-muted">
                    <span className={server.status === "running" ? "size-2 rounded-full bg-ok" : "size-2 rounded-full bg-border"} />
                    {server.installedAt ? server.status : "installing"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
