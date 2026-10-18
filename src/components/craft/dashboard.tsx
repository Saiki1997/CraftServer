import { Link } from "@tanstack/react-router";
import { Installer } from "@/components/craft/installer";
import { useCraft } from "@/lib/mc/store";

export function Dashboard() {
  const servers = useCraft((s) => s.servers);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12">
      <Installer heading="home" />
      <section>
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-base font-medium">Your servers</h2>
          <Link to="/servers" className="text-sm text-muted hover:text-foreground">
            View all
          </Link>
        </div>
        {servers.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing installed in this browser yet. A pack above creates the first one.</p>
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
