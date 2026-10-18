import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Panel } from "@/components/craft/confirm";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { resolveServerPlan } from "@/lib/mc/api";
import { useCraft } from "@/lib/mc/store";

export function DownloadsPage() {
  const jobs = useCraft((s) => s.jobs);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-display">Downloads</h1>
      <p className="text-sm text-muted">Install stages retry without wiping stages that already succeeded. Pack files download later, on your computer, via install.ps1.</p>
      <a
        href="https://github.com/Saiki1997/CraftServer/releases/download/v1.1.0/CraftServer-Windows.zip"
        className="inline-flex h-11 w-fit items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground"
      >
        Windows app zip
      </a>
      {jobs.length === 0 ? <p className="text-sm text-muted">No jobs yet.</p> : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {jobs.map((job) => (
            <li key={job.id + job.updatedAt} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{job.name}</span>
                <span className="tabular-nums text-muted">{job.status} · try {job.attempts}</span>
              </div>
              <div className="mt-1 text-muted">{job.stage}{job.error ? ` — ${job.error}` : ""}</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-accent" style={{ width: `${job.progress}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function JavaPage() {
  const runtimes = useCraft((s) => s.runtimes);
  const servers = useCraft((s) => s.servers);
  const [major, setMajor] = useState(21);
  const [error, setError] = useState("");
  const [path, setPath] = useState("");

  async function resolve() {
    setError("");
    try {
      const version = ({ 8: "1.16.5", 16: "1.17.1", 17: "1.20.1", 21: "1.21.1", 25: "26.1" } as Record<number, string>)[major] ?? "1.21.1";
      const plan = await resolveServerPlan({
        data: { minecraftVersion: version, loader: "vanilla", loaderVersion: "" },
      });
      useCraft.getState().addRuntime({
        id: crypto.randomUUID(),
        major: plan.javaMajor,
        vendor: "temurin",
        label: `Temurin ${plan.javaMajor}`,
        path: `runtime/java${plan.javaMajor}`,
        builds: plan.builds,
        verified: true,
        note: plan.javaNote,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve Java.");
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-display">Java</h1>
      <p className="text-sm text-muted">Runtimes are resolved from Adoptium and stored per server. Nothing is installed over a system Java.</p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Panel title="Resolve a Temurin build">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="java-major">Major</Label>
            <Select id="java-major" value={major} onChange={(e) => setMajor(Number(e.target.value))}>
              {[8, 16, 17, 21, 25].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </div>
          <Button variant="primary" onClick={() => void resolve()}>Resolve</Button>
        </div>
      </Panel>
      <Panel title="Manual path">
        <p className="mb-2 text-sm text-muted">Unverified until the start script runs on your machine.</p>
        <div className="flex gap-2">
          <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Program Files\Eclipse Adoptium\jdk-21\bin\java.exe" aria-label="Java path" />
          <Button
            onClick={() => {
              if (!path.trim()) return;
              useCraft.getState().addRuntime({
                id: crypto.randomUUID(),
                major,
                vendor: "manual",
                label: `Manual Java ${major}`,
                path: path.trim(),
                verified: false,
                note: "Path saved only. It was not executed.",
              });
              setPath("");
            }}
          >
            Save
          </Button>
        </div>
      </Panel>
      <ul className="space-y-3">
        {runtimes.map((runtime) => (
          <li key={runtime.id} className="rounded-xl border border-border bg-card p-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{runtime.label}</span>
              <Button size="sm" variant="ghost" onClick={() => useCraft.getState().removeRuntime(runtime.id)}>Remove</Button>
            </div>
            <p className="mt-1 text-muted">{runtime.path} · {runtime.verified ? "URL resolved" : "unverified path"}</p>
            <p className="mt-1 text-muted">{runtime.note}</p>
            {runtime.builds?.windows ? <p className="mt-1 truncate text-muted">{runtime.builds.windows.filename}</p> : null}
            <Label>Assign to</Label>
            <Select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  useCraft.getState().updateServer(e.target.value, {
                    runtimeId: runtime.id,
                    javaMajor: runtime.major,
                    manualJavaPath: runtime.vendor === "manual" ? runtime.path : "",
                  });
                }
              }}
            >
              <option value="">Choose a server</option>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BackupsPage() {
  const servers = useCraft((s) => s.servers);
  const rows = servers.flatMap((server) => server.backups.map((backup) => ({ server, backup })));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-display">Backups</h1>
      <p className="text-sm text-muted">Snapshots stay in this browser. Restoring never deletes a world folder, because worlds are only on the machine that runs the server.</p>
      {rows.length === 0 ? <p className="text-sm text-muted">No snapshots.</p> : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map(({ server, backup }) => (
            <li key={backup.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span>{server.name} · {backup.label}</span>
              <Link to="/servers/$serverId" params={{ serverId: server.id }} className="text-muted underline">Open</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SettingsPage() {
  const settings = useCraft((s) => s.settings);
  const theme = useCraft((s) => s.theme);
  const [key, setKey] = useState(settings.curseforgeKey);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-display">Settings</h1>
      <Panel title="Appearance">
        <Button onClick={() => useCraft.getState().setTheme(theme === "dark" ? "light" : "dark")}>
          Use {theme === "dark" ? "light" : "dark"} theme
        </Button>
      </Panel>
      <Panel title="CurseForge API key">
        <p className="mb-2 text-sm text-muted">Stored in this browser only, not encrypted. It is sent with CurseForge requests you start.</p>
        <Input value={key} onChange={(e) => setKey(e.target.value)} type="password" autoComplete="off" aria-label="CurseForge API key" />
        <Button className="mt-2" onClick={() => useCraft.getState().setSettings({ curseforgeKey: key.trim() })}>Save key</Button>
      </Panel>
      <Panel title="Backups and hosts">
        <Label htmlFor="keep">Snapshots to keep per server</Label>
        <Input
          id="keep"
          type="number"
          min={1}
          max={30}
          defaultValue={settings.backupKeep}
          onBlur={(e) => useCraft.getState().setSettings({ backupKeep: Math.min(30, Math.max(1, Number(e.target.value) || 8)) })}
        />
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.allowUnlistedHosts}
            onChange={(e) => useCraft.getState().setSettings({ allowUnlistedHosts: e.target.checked })}
          />
          Allow https downloads from hosts outside the trusted list. Private addresses stay blocked.
        </label>
      </Panel>
    </div>
  );
}
