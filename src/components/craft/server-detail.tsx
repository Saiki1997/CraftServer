import * as Tabs from "@radix-ui/react-tabs";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Confirm, Panel } from "@/components/craft/confirm";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, TextArea } from "@/components/ui/field";
import { checkPackUpdate, inspectPackUrl, installModBundle, lookupMod } from "@/lib/mc/api";
import { diagnoseLog } from "@/lib/mc/diagnose";
import { downloadZip } from "@/lib/mc/export-pack";
import { makeServer } from "@/lib/mc/factory";
import { cancelInstall, resetFailed, runInstall } from "@/lib/mc/install";
import { G1_FLAGS, recommendRam } from "@/lib/mc/recommend";
import { launchCommand } from "@/lib/mc/scripts";
import { logLine, pushBackup, snapshot, useCraft } from "@/lib/mc/store";
import type { LoaderKind, LogLevel, ServerRecord } from "@/lib/mc/types";

const LOADERS: LoaderKind[] = ["forge", "neoforge", "fabric", "quilt", "vanilla", "legacy-fabric", "unknown"];

export function ServerDetail({ serverId }: { serverId: string }) {
  const server = useCraft((s) => s.servers.find((item) => item.id === serverId));
  if (!server) {
    return (
      <p className="text-sm text-muted">
        That server is not saved. <Link to="/servers" className="underline">Back to servers</Link>
      </p>
    );
  }
  return <Detail server={server} />;
}

function Detail({ server }: { server: ServerRecord }) {
  const settings = useCraft((s) => s.settings);
  const [tab, setTab] = useState("overview");
  const [confirm, setConfirm] = useState<null | "delete" | "restore">(null);
  const [restoreId, setRestoreId] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const [logLevel, setLogLevel] = useState<LogLevel | "">("");
  const [modNote, setModNote] = useState("");
  const [command, setCommand] = useState("");
  const [stick, setStick] = useState(true);
  const [crash, setCrash] = useState("");
  const [modQuery, setModQuery] = useState("");
  const [modSlug, setModSlug] = useState("");
  const [modHits, setModHits] = useState<Array<{ id: string; version: string; loaders: string[]; gameVersions: string[]; files: ServerRecord["files"]; deps: string[] }>>([]);
  const [updateNote, setUpdateNote] = useState("");
  const history = useRef<number>(-1);
  const logRef = useRef<HTMLDivElement>(null);
  const findings = useMemo(() => diagnoseLog(crash, server.javaMajor), [crash, server.javaMajor]);
  const advice = recommendRam(server.files, server.minecraftVersion);
  const lines = server.console.filter((line) => {
    if (logLevel && line.level !== logLevel) return false;
    return !logQuery || line.text.toLowerCase().includes(logQuery.toLowerCase());
  });

  useEffect(() => {
    if (!stick) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, stick]);

  function patch(partial: Partial<ServerRecord>) {
    useCraft.getState().updateServer(server.id, partial);
  }

  function arm() {
    const problems: string[] = [];
    if (!server.installedAt) problems.push("Install has not verified. Retry the failed stage first.");
    if (!server.eulaAccepted) problems.push("Minecraft EULA is not accepted.");
    if (!server.manualJavaPath.trim() && !server.plan?.builds.windows) problems.push("No Java build is resolved.");
    const text = problems.length ? problems.join(" ") : launchCommand(server);
    patch({
      console: [...server.console, logLine(problems.length ? "error" : "system", text)].slice(-400),
    });
  }

  function sendCommand(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    patch({
      commandHistory: [...server.commandHistory, trimmed].slice(-50),
      queuedCommands: [...server.queuedCommands, trimmed].slice(-100),
      console: [...server.console, logLine("in", trimmed), logLine("system", "Queued. It is written to queued-commands.txt in the download. This preview has no live JVM.")].slice(-400),
    });
    setCommand("");
    history.current = -1;
  }

  async function onUpdate() {
    setUpdateNote("");
    if (server.pack.sourceRef.provider !== "modrinth" || !server.pack.sourceRef.projectId) {
      setUpdateNote("Update checks are available for Modrinth projects.");
      return;
    }
    try {
      const latest = await checkPackUpdate({
        data: { projectId: server.pack.sourceRef.projectId, currentId: server.pack.sourceRef.versionId ?? "" },
      });
      if (!latest.update) {
        setUpdateNote(`Already on the newest release (${latest.version}).`);
        return;
      }
      const next = await inspectPackUrl({
        data: { url: `https://modrinth.com/modpack/${server.pack.sourceRef.slug}/version/${latest.id}`, curseforgeKey: settings.curseforgeKey, allowUnlisted: settings.allowUnlistedHosts },
      });
      const snap = snapshot(server, "update", `Before ${next.version}`);
      patch({
        backups: pushBackup(server, snap),
        pack: next,
        files: next.files,
        minecraftVersion: next.minecraftVersion,
        loader: next.loader,
        loaderVersion: next.loaderVersion,
        javaMajor: next.javaMajor,
        javaSource: next.javaSource,
        javaNote: next.javaNote,
        installedAt: undefined,
        installError: undefined,
        installStages: server.installStages.map((stage) => ({ ...stage, state: "pending", detail: undefined })),
        plan: undefined,
      });
      setUpdateNote(`Updated metadata to ${next.version}. Properties, port, and RAM were kept. World files are not stored here and were not touched. Re-run install to verify the new loader.`);
      useCraft.getState().pushActivity(`Updated ${server.name} to ${next.version}`, server.id);
    } catch (err) {
      setUpdateNote(err instanceof Error ? err.message : "Update check failed.");
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          {server.pack.iconUrl ? <img src={server.pack.iconUrl} alt="" className="size-14 rounded-md object-cover" /> : null}
          <div>
          <Link to="/servers" className="text-sm text-muted">Servers</Link>
          <h1 className="text-display">{server.name}</h1>
          <p className="text-sm text-muted">
            {server.minecraftVersion} · {server.loader} {server.loaderVersion} · Java {server.javaMajor} · {server.directoryLabel}
          </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              downloadZip(server);
              patch({ console: [...server.console, logLine("system", "Downloaded the server folder. Existing worlds are not inside this zip.")].slice(-400) });
            }}
          >
            Download folder
          </Button>
          <Button onClick={arm}>Start checklist</Button>
          <Button
            onClick={() => patch({ status: server.status === "running" ? "stopped" : "running", lastPlayed: Date.now() })}
          >
            {server.status === "running" ? "Mark stopped" : "Mark running"}
          </Button>
        </div>
      </header>
      <p className="text-sm text-muted">
        CPU, RAM use, and player count stay blank because no server process is hosted here. Mark running only after you start it on your machine.
      </p>

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="flex gap-1 overflow-x-auto">
          {[["overview", "Overview"], ["console", "Logs"], ["mods", "Mods"], ["config", "Settings"], ["network", "Network"], ["backups", "Backups"], ["diagnose", "Diagnose"]].map(([id, label]) => (
            <Tabs.Trigger key={id} value={id} className="h-11 shrink-0 rounded-md px-3 text-sm text-muted transition-colors duration-150 data-[state=active]:bg-secondary data-[state=active]:text-foreground">
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="overview" className="mt-4 grid gap-3">
          <Panel title="Install">
            <ul className="space-y-2">
              {server.installStages.map((stage) => (
                <li key={stage.id} className="flex items-start justify-between gap-3 text-sm">
                  <span>{stage.label}</span>
                  <span className={stage.state === "failed" ? "text-destructive" : "text-muted"}>
                    {stage.state}{stage.detail ? ` — ${stage.detail}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {server.installError ? <p className="mt-3 text-sm text-destructive">{server.installError}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => { resetFailed(server.id); void runInstall(server.id); }}>Retry failed stage</Button>
              <Button size="sm" onClick={() => cancelInstall(server.id)}>Cancel</Button>
            </div>
            <p className="mt-3 text-sm text-muted">{server.pack.serverPackNote}</p>
            <p className="mt-2 text-sm text-muted">{server.javaNote}</p>
          </Panel>
          <Panel title="Performance suggestion">
            <p className="text-sm">{advice.reason}</p>
            <p className="mt-1 text-sm tabular-nums text-muted">Suggested {advice.minMb}–{advice.maxMb} MB. Current {server.ramMinMb}–{server.ramMaxMb} MB.</p>
            <Button className="mt-3" size="sm" onClick={() => patch({ ramMinMb: advice.minMb, ramMaxMb: advice.maxMb, backups: pushBackup(server, snapshot(server, "edit", "Before RAM change")) })}>
              Apply RAM suggestion
            </Button>
          </Panel>
          <Panel title="Updates">
            <p className="text-sm text-muted">A backup is stored before metadata changes. server.properties values you already set are kept.</p>
            <Button className="mt-3" size="sm" onClick={() => void onUpdate()}>Check Modrinth</Button>
            {updateNote ? <p className="mt-2 text-sm">{updateNote}</p> : null}
          </Panel>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => {
              const copy = makeServer(server.pack, { name: `${server.name} copy`, port: server.port, ramMinMb: server.ramMinMb, ramMaxMb: server.ramMaxMb, excludeClient: false }, useCraft.getState().servers.map((s) => s.port));
              copy.files = server.files.map((f) => ({ ...f }));
              copy.loader = server.loader;
              copy.loaderVersion = server.loaderVersion;
              copy.motd = server.motd;
              useCraft.getState().addServer(copy);
            }}>Duplicate</Button>
            <Button size="sm" variant="danger" onClick={() => setConfirm("delete")}>Delete</Button>
          </div>
        </Tabs.Content>

        <Tabs.Content value="console" className="craft-rise mt-4">
          <Panel title="Logs">
            <div className="mb-2 flex flex-wrap gap-2">
              <Input value={logQuery} onChange={(e) => setLogQuery(e.target.value)} placeholder="Search logs" aria-label="Search logs" />
              {(["", "info", "warn", "error", "system", "in"] as const).map((level) => (
                <button
                  key={level || "all"}
                  type="button"
                  onClick={() => setLogLevel(level)}
                  className={`h-9 rounded-full px-3 text-sm transition-colors duration-150 ${logLevel === level ? "bg-accent text-accent-foreground" : "bg-secondary text-muted"}`}
                >
                  {level || "all"}
                </button>
              ))}
              <Button size="sm" onClick={() => navigator.clipboard.writeText(lines.map((l) => l.text).join("\n"))}>Copy</Button>
              <Button size="sm" onClick={() => patch({ console: [] })}>Clear display</Button>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={stick} onChange={(e) => setStick(e.target.checked)} />
                Follow
              </label>
            </div>
            <div
              ref={logRef}
              className="h-80 overflow-auto rounded-md bg-background p-3 font-mono text-xs leading-5"
              onScroll={() => undefined}
            >
              {lines.map((line) => (
                <div key={line.id} className={line.level === "error" ? "text-destructive" : line.level === "warn" ? "text-warn" : line.level === "in" ? "text-foreground" : "text-muted"}>
                  <span className="tabular-nums">{new Date(line.t).toLocaleTimeString()} </span>
                  {line.text}
                </div>
              ))}
            </div>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                sendCommand(command);
              }}
            >
              <Input
                value={command}
                aria-label="Command"
                placeholder="help, list, save-all, whitelist, ban, kick, op, deop, gamerule"
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    const next = history.current < 0 ? server.commandHistory.length - 1 : Math.max(0, history.current - 1);
                    history.current = next;
                    setCommand(server.commandHistory[next] ?? "");
                  }
                }}
              />
              <Button type="submit" variant="primary">Send</Button>
            </form>
          </Panel>
        </Tabs.Content>

        <Tabs.Content value="mods" className="craft-rise mt-4 grid gap-3">
          <Panel title="Mods">
            <Input value={modQuery} onChange={(e) => setModQuery(e.target.value)} placeholder="Filter" aria-label="Filter mods" />
            <ul className="mt-3 max-h-[28rem] divide-y divide-border overflow-auto">
              {server.files
                .filter((f) => !modQuery || f.path.toLowerCase().includes(modQuery.toLowerCase()))
                .slice(0, 300)
                .map((file) => (
                  <li key={file.path} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{file.path}</div>
                      <div className="text-xs text-muted">
                        {file.clientOnly ? "client-only" : file.uncertain ? "side unknown — kept" : file.side}
                        {file.note ? ` · ${file.note}` : ""}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={file.included ? "secondary" : "ghost"}
                      onClick={() =>
                        patch({
                          files: server.files.map((item) => (item.path === file.path ? { ...item, included: !item.included } : item)),
                        })
                      }
                    >
                      {file.included ? "Included" : "Excluded"}
                    </Button>
                  </li>
                ))}
            </ul>
          </Panel>
          <Panel title="Add a mod and its dependencies">
            <p className="mb-3 text-sm text-muted">Looks up a Modrinth mod for {server.loader} on Minecraft {server.minecraftVersion}, then adds required dependencies that have a matching build.</p>
            <form
              className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
              onSubmit={(e) => {
                e.preventDefault();
                const slug = modSlug.trim().replace(/^https:\/\/modrinth.com\/mod\//, "").split(/[/?#]/)[0];
                if (!slug) return;
                setModNote("");
                void lookupMod({ data: { slug } })
                  .then((hits) => setModHits(hits.filter((hit) => hit.loaders.includes(server.loader === "legacy-fabric" ? "fabric" : server.loader) && hit.gameVersions.includes(server.minecraftVersion)).concat(hits).filter((hit, i, all) => all.findIndex((item) => item.id === hit.id) === i).slice(0, 8)))
                  .catch((err) => setModNote(err instanceof Error ? err.message : "Lookup failed."));
              }}
            >
              <Input value={modSlug} onChange={(e) => setModSlug(e.target.value)} placeholder="mod slug or URL" aria-label="Mod slug" />
              <Button type="submit">Look up</Button>
              <Button
                variant="primary"
                type="button"
                onClick={() => {
                  const slug = modSlug.trim().replace(/^https:\/\/modrinth.com\/mod\//, "").split(/[/?#]/)[0];
                  if (!slug) return;
                  setModNote("Resolving dependencies…");
                  void installModBundle({ data: { slug, loader: server.loader, minecraftVersion: server.minecraftVersion } })
                    .then((bundle) => {
                      const have = new Set(server.files.map((file) => file.path));
                      const added = bundle.files.filter((item) => !have.has(item.file.path));
                      patch({
                        files: [...server.files, ...added.map((item) => item.file)],
                        console: [...server.console, logLine("system", `Added ${added.map((item) => item.title).join(", ") || "nothing new"}.`)].slice(-400),
                      });
                      setModNote(
                        added.length
                          ? `Added ${added.map((item) => item.title).join(", ")}.${bundle.missing.length ? ` No compatible build for: ${bundle.missing.join(", ")}.` : ""}`
                          : "Those files are already on this server.",
                      );
                    })
                    .catch((err) => setModNote(err instanceof Error ? err.message : "Could not add that mod."));
                }}
              >
                Add with dependencies
              </Button>
            </form>
            {modNote ? <p className="mt-2 text-sm">{modNote}</p> : null}
            <ul className="mt-3 space-y-2">
              {modHits.map((hit) => (
                <li key={hit.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{hit.version} · {hit.loaders.join(", ")} · {hit.gameVersions.slice(0, 2).join(", ")}{hit.deps.length ? ` · ${hit.deps.length} required` : ""}</span>
                  <Button
                    size="sm"
                    onClick={() => {
                      const file = hit.files[0];
                      if (!file || server.files.some((f) => f.path === file.path)) return;
                      patch({ files: [...server.files, file] });
                      setModNote(hit.deps.length ? "File only. Use Add with dependencies to pull required projects." : "Added the file.");
                    }}
                  >
                    File only
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        </Tabs.Content>

        <Tabs.Content value="config" className="craft-rise mt-4 grid gap-3">
          <Panel title="Java">
            <p className="text-sm text-muted">Memory and JVM arguments are per server, the same way an instance keeps its own runtime. They are written into the downloaded start script. Java still runs on your computer.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Min RAM MB" value={String(server.ramMinMb)} onChange={(v) => patch({ ramMinMb: Number(v) || 512 })} />
              <Field label="Max RAM MB" value={String(server.ramMaxMb)} onChange={(v) => patch({ ramMaxMb: Number(v) || 512 })} />
              <Field label="Manual Java path" value={server.manualJavaPath} onChange={(v) => patch({ manualJavaPath: v })} />
            </div>
            <div className="mt-4">
              <Label>JVM arguments</Label>
              <pre className="mt-2 mb-3 overflow-auto rounded-md bg-background p-3 font-mono text-xs leading-5">{launchCommand(server)}</pre>
              <TextArea value={server.extraJvm} onChange={(e) => patch({ extraJvm: e.target.value })} aria-label="JVM arguments" />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => patch({ gc: "g1", extraJvm: G1_FLAGS, backups: pushBackup(server, snapshot(server, "edit", "Before JVM flags")) })}>
                  Use G1 flags
                </Button>
                <Button size="sm" variant="ghost" onClick={() => patch({ gc: "default", extraJvm: "" })}>Clear flags</Button>
                <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(server.extraJvm || launchCommand(server))}>Copy</Button>
              </div>
            </div>
          </Panel>
          <Panel title="Game">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="MOTD" value={server.motd} onChange={(v) => patch({ motd: v })} />
              <Field label="Port" value={String(server.port)} onChange={(v) => patch({ port: Number(v) || server.port })} />
              <Field label="Max players" value={String(server.maxPlayers)} onChange={(v) => patch({ maxPlayers: Number(v) || 1 })} />
              <Field label="View distance" value={String(server.viewDistance)} onChange={(v) => patch({ viewDistance: Number(v) || 10 })} />
              <Field label="Simulation distance" value={String(server.simulationDistance)} onChange={(v) => patch({ simulationDistance: Number(v) || 10 })} />
              <div>
                <Label>Difficulty</Label>
                <Select value={server.difficulty} onChange={(e) => patch({ difficulty: e.target.value as ServerRecord["difficulty"] })}>
                  {["peaceful", "easy", "normal", "hard"].map((v) => <option key={v}>{v}</option>)}
                </Select>
              </div>
              <div>
                <Label>Game mode</Label>
                <Select value={server.gamemode} onChange={(e) => patch({ gamemode: e.target.value as ServerRecord["gamemode"] })}>
                  {["survival", "creative", "adventure", "spectator"].map((v) => <option key={v}>{v}</option>)}
                </Select>
              </div>
              <div>
                <Label>Loader</Label>
                <Select value={server.loader} onChange={(e) => patch({ loader: e.target.value as LoaderKind })}>
                  {LOADERS.map((v) => <option key={v}>{v}</option>)}
                </Select>
              </div>
              <Field label="Loader version" value={server.loaderVersion} onChange={(v) => patch({ loaderVersion: v })} />
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <Check label="Online mode" checked={server.onlineMode} onChange={(v) => patch({ onlineMode: v })} />
              <Check label="PVP" checked={server.pvp} onChange={(v) => patch({ pvp: v })} />
              <Check label="Whitelist" checked={server.whitelist} onChange={(v) => patch({ whitelist: v })} />
              <Check label="Command blocks" checked={server.commandBlocks} onChange={(v) => patch({ commandBlocks: v })} />
              <Check label="EULA accepted" checked={server.eulaAccepted} onChange={(v) => patch({ eulaAccepted: v })} />
            </div>
          </Panel>
        </Tabs.Content>

        <Tabs.Content value="network" className="mt-4">
          <Panel title="Connection">
            <p className="text-sm">Port {server.port}. Bind address {server.bindIp || "(all interfaces)"}.</p>
            <p className="mt-2 text-sm text-muted">This preview cannot see your LAN address or open a firewall. Do not assume the server is reachable from the internet.</p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
              <li>On the computer running the server, allow inbound TCP {server.port} in Windows Firewall only if you want LAN players to join.</li>
              <li>Other computers on the same network use that computer’s local IP and port {server.port}.</li>
              <li>Port forwarding is a router setting you change yourself. CraftServer will not log into your router.</li>
              <li>Online mode stays {server.onlineMode ? "on" : "off"}. Leave it on unless you understand the risk.</li>
            </ol>
            <div className="mt-3">
              <Label>Bind IP (blank for all)</Label>
              <Input value={server.bindIp} onChange={(e) => patch({ bindIp: e.target.value })} />
            </div>
            <Check label="RCON" checked={server.rconEnabled} onChange={(v) => patch({ rconEnabled: v })} />
            {server.rconEnabled ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label="RCON port" value={String(server.rconPort)} onChange={(v) => patch({ rconPort: Number(v) || server.rconPort })} />
                <Field label="RCON password" value={server.rconPassword} onChange={(v) => patch({ rconPassword: v })} />
              </div>
            ) : null}
          </Panel>
        </Tabs.Content>

        <Tabs.Content value="backups" className="mt-4">
          <Panel
            title="Config snapshots"
            action={<Button size="sm" onClick={() => patch({ backups: pushBackup(server, snapshot(server, "manual", "Manual snapshot")) })}>Save snapshot</Button>}
          >
            <p className="mb-3 text-sm text-muted">These snapshots store properties and the mod list in this browser. They do not contain world files, and restoring one asks first.</p>
            {server.backups.length === 0 ? <p className="text-sm text-muted">No snapshots.</p> : (
              <ul className="divide-y divide-border">
                {server.backups.map((backup) => (
                  <li key={backup.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>{backup.label} · {new Date(backup.at).toLocaleString()} · {backup.minecraftVersion}</span>
                    <Button size="sm" onClick={() => { setRestoreId(backup.id); setConfirm("restore"); }}>Restore</Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Tabs.Content>

        <Tabs.Content value="diagnose" className="mt-4">
          <Panel title="Crash report">
            <p className="mb-2 text-sm text-muted">Paste latest.log or a crash report. Suggestions do not change files until you apply one.</p>
            <TextArea value={crash} onChange={(e) => setCrash(e.target.value)} placeholder="Paste the log" />
            <ul className="mt-3 space-y-3">
              {findings.map((finding) => (
                <li key={finding.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="font-medium">{finding.title}</div>
                  <p className="mt-1 text-muted">{finding.detail}</p>
                  <p className="mt-1">{finding.suggestion}</p>
                  {finding.action === "java" && finding.javaMajor ? (
                    <Button className="mt-2" size="sm" onClick={() => patch({ javaMajor: finding.javaMajor, backups: pushBackup(server, snapshot(server, "edit", "Before Java change")) })}>
                      Assign Java {finding.javaMajor}
                    </Button>
                  ) : null}
                  {finding.action === "ram" ? (
                    <Button className="mt-2" size="sm" onClick={() => patch({ ramMaxMb: Math.min(server.ramMaxMb + 2048, 16384) })}>Raise max RAM by 2 GB</Button>
                  ) : null}
                  {finding.action === "port" ? (
                    <Button className="mt-2" size="sm" onClick={() => patch({ port: server.port + 1 })}>Use port {server.port + 1}</Button>
                  ) : null}
                  {finding.action === "eula" ? (
                    <Button className="mt-2" size="sm" onClick={() => patch({ eulaAccepted: true })}>Accept EULA</Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        </Tabs.Content>
      </Tabs.Root>

      <Confirm
        open={confirm === "delete"}
        title={`Delete ${server.name}?`}
        body="This removes the saved instance from this browser. It does not delete a folder on your computer."
        confirmLabel="Delete"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          useCraft.getState().removeServer(server.id);
          setConfirm(null);
        }}
      />
      <Confirm
        open={confirm === "restore"}
        title="Restore this snapshot?"
        body="Current properties and the mod list are replaced by the snapshot. A new snapshot of the current state is kept first. World files are not involved."
        confirmLabel="Restore"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const backup = server.backups.find((item) => item.id === restoreId);
          if (!backup) return;
          const point = snapshot(server, "restore-point", "Before restore");
          patch({
            minecraftVersion: backup.minecraftVersion,
            loader: backup.loader,
            loaderVersion: backup.loaderVersion,
            ramMinMb: backup.ramMinMb,
            ramMaxMb: backup.ramMaxMb,
            port: backup.port,
            maxPlayers: backup.maxPlayers,
            motd: backup.motd,
            difficulty: backup.difficulty as ServerRecord["difficulty"],
            gamemode: backup.gamemode as ServerRecord["gamemode"],
            viewDistance: backup.viewDistance,
            simulationDistance: backup.simulationDistance,
            onlineMode: backup.onlineMode,
            pvp: backup.pvp,
            whitelist: backup.whitelist,
            commandBlocks: backup.commandBlocks,
            extraJvm: backup.extraJvm,
            gc: backup.gc,
            files: backup.files,
            backups: pushBackup({ ...server, backups: server.backups }, point),
            installedAt: undefined,
          });
          setConfirm(null);
        }}
      />
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = label.replace(/\s+/g, "-").toLowerCase();
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="mt-3 flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
