import * as Tabs from "@radix-ui/react-tabs";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Panel } from "@/components/craft/confirm";
import { Button } from "@/components/ui/button";
import { Input, TextArea } from "@/components/ui/field";
import { installModBundle, lookupMod } from "@/lib/mc/api";
import { downloadPlayZip } from "@/lib/mc/export-play";
import { cancelPlayInstall, resetPlayFailed, runPlayInstall } from "@/lib/mc/install-play";
import { G1_FLAGS } from "@/lib/mc/recommend";
import { logLine, useCraft } from "@/lib/mc/store";
import type { PlayRecord } from "@/lib/mc/types";

export function PlayDetail({ playId }: { playId: string }) {
  const play = useCraft((s) => (s.plays ?? []).find((item) => item.id === playId));
  if (!play) {
    return (
      <p className="text-sm text-muted">
        That instance is not saved. <Link to="/play" className="underline">Back to play</Link>
      </p>
    );
  }
  return <Detail play={play} />;
}

function Detail({ play }: { play: PlayRecord }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [modQuery, setModQuery] = useState("");
  const [modSlug, setModSlug] = useState("");
  const [modNote, setModNote] = useState("");
  const [modHits, setModHits] = useState<Array<{ id: string; version: string; loaders: string[]; gameVersions: string[]; files: PlayRecord["files"]; deps: string[] }>>([]);

  function patch(partial: Partial<PlayRecord>) {
    useCraft.getState().updatePlay(play.id, partial);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          {play.pack.iconUrl ? <img src={play.pack.iconUrl} alt="" className="size-14 rounded-md object-cover" /> : null}
          <div>
            <Link to="/play" className="text-sm text-muted">Play</Link>
            <h1 className="text-display">{play.name}</h1>
            <p className="text-sm text-muted">
              {play.minecraftVersion} · {play.loader} {play.loaderVersion} · Java {play.javaMajor} · {play.width}×{play.height}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              downloadPlayZip(play);
              patch({ console: [...play.console, logLine("system", "Downloaded the play folder. The game was not started.")].slice(-400), lastPlayed: Date.now() });
            }}
          >
            Download instance
          </Button>
          <Button onClick={() => { resetPlayFailed(play.id); void runPlayInstall(play.id); }}>Retry install</Button>
          <Button
            onClick={() => {
              cancelPlayInstall(play.id);
              useCraft.getState().removePlay(play.id);
              void navigate({ to: "/play" });
            }}
          >
            Delete
          </Button>
        </div>
      </header>
      <p className="text-sm text-muted">
        Client mods stay in this instance. Minecraft is not launched here, and no Microsoft account is collected.
      </p>
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="flex gap-1 overflow-x-auto">
          {[["overview", "Overview"], ["mods", "Mods"], ["java", "Java"], ["logs", "Logs"]].map(([id, label]) => (
            <Tabs.Trigger key={id} value={id} className="h-11 shrink-0 rounded-md px-3 text-sm text-muted transition-colors duration-150 data-[state=active]:bg-secondary data-[state=active]:text-foreground">
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="overview" className="mt-4">
          <Panel title="Install">
            <ul className="space-y-2">
              {play.installStages.map((stage) => (
                <li key={stage.id} className="flex items-start justify-between gap-3 text-sm">
                  <span>{stage.label}</span>
                  <span className={stage.state === "failed" ? "text-destructive" : "text-muted"}>{stage.state}{stage.detail ? ` — ${stage.detail}` : ""}</span>
                </li>
              ))}
            </ul>
            {play.installError ? <p className="mt-3 text-sm text-destructive">{play.installError}</p> : null}
          </Panel>
        </Tabs.Content>
        <Tabs.Content value="mods" className="craft-rise mt-4 grid gap-3">
          <Panel title="Mods">
            <Input value={modQuery} onChange={(e) => setModQuery(e.target.value)} placeholder="Filter" aria-label="Filter mods" />
            <ul className="mt-3 max-h-[28rem] divide-y divide-border overflow-auto">
              {play.files.filter((file) => !modQuery || file.path.toLowerCase().includes(modQuery.toLowerCase())).slice(0, 300).map((file) => (
                <li key={file.path} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">{file.path}</div>
                    <div className="text-xs text-muted">{file.clientOnly ? "client" : file.side}{file.note ? ` · ${file.note}` : ""}</div>
                  </div>
                  <Button size="sm" variant={file.included ? "secondary" : "ghost"} onClick={() => patch({ files: play.files.map((item) => item.path === file.path ? { ...item, included: !item.included } : item) })}>
                    {file.included ? "Included" : "Excluded"}
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Add a mod and its dependencies">
            <p className="mb-3 text-sm text-muted">Required Modrinth dependencies that match {play.loader} on {play.minecraftVersion} are added with the mod. Client files stay included.</p>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                const slug = modSlug.trim().replace(/^https:\/\/modrinth.com\/mod\//, "").split(/[/?#]/)[0];
                if (!slug) return;
                setModNote("");
                void lookupMod({ data: { slug } })
                  .then((hits) => setModHits(hits.slice(0, 8)))
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
                  void installModBundle({ data: { slug, loader: play.loader, minecraftVersion: play.minecraftVersion } })
                    .then((bundle) => {
                      const have = new Set(play.files.map((file) => file.path));
                      const added = bundle.files.filter((item) => !have.has(item.file.path));
                      patch({
                        files: [...play.files, ...added.map((item) => item.file)],
                        console: [...play.console, logLine("system", `Added ${added.map((item) => item.title).join(", ") || "nothing new"}.`)].slice(-400),
                      });
                      setModNote(added.length ? `Added ${added.map((item) => item.title).join(", ")}.${bundle.missing.length ? ` No compatible build for: ${bundle.missing.join(", ")}.` : ""}` : "Those files are already on this instance.");
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
                <li key={hit.id} className="text-sm text-muted">{hit.version} · {hit.loaders.join(", ")} · {hit.gameVersions.slice(0, 2).join(", ")}</li>
              ))}
            </ul>
          </Panel>
        </Tabs.Content>
        <Tabs.Content value="java" className="mt-4">
          <Panel title="Java and window">
            <p className="text-sm text-muted">Memory, the extra JVM line, and the window size are written into the downloaded instance. Java still runs on your computer.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Min RAM MB
                <Input className="mt-1" value={String(play.ramMinMb)} onChange={(e) => patch({ ramMinMb: Number(e.target.value) || 512 })} aria-label="Min RAM MB" />
              </label>
              <label className="text-sm">Max RAM MB
                <Input className="mt-1" value={String(play.ramMaxMb)} onChange={(e) => patch({ ramMaxMb: Number(e.target.value) || 512 })} aria-label="Max RAM MB" />
              </label>
              <label className="text-sm">Width
                <Input className="mt-1" value={String(play.width)} onChange={(e) => patch({ width: Number(e.target.value) || 1280 })} aria-label="Window width" />
              </label>
              <label className="text-sm">Height
                <Input className="mt-1" value={String(play.height)} onChange={(e) => patch({ height: Number(e.target.value) || 720 })} aria-label="Window height" />
              </label>
            </div>
            <label className="mt-3 block text-sm">Manual Java path
              <Input className="mt-1" value={play.manualJavaPath} onChange={(e) => patch({ manualJavaPath: e.target.value })} aria-label="Manual Java path" />
            </label>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-sm text-muted">Extra JVM arguments</span>
              <Button size="sm" onClick={() => patch({ extraJvm: G1_FLAGS, gc: "g1" })}>Use G1</Button>
            </div>
            <TextArea className="mt-2" value={play.extraJvm} onChange={(e) => patch({ extraJvm: e.target.value })} aria-label="JVM arguments" />
          </Panel>
        </Tabs.Content>
        <Tabs.Content value="logs" className="mt-4">
          <Panel title="Notes">
            {play.console.length === 0 ? <p className="text-sm text-muted">No notes yet.</p> : (
              <ul className="max-h-80 space-y-2 overflow-auto font-mono text-xs">
                {play.console.map((line) => (
                  <li key={line.id}><span className="text-muted">{line.level}</span> {line.text}</li>
                ))}
              </ul>
            )}
          </Panel>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
