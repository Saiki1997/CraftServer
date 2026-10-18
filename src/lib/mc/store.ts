import { create } from "zustand";
import { persist } from "zustand/middleware";
import { recommendRam } from "./recommend.ts";
import { STAGE_DEFS, type Activity, type AppSettings, type BackupSnap, type DownloadJob, type LogLine, type PackFile, type PlayRecord, type RuntimeRecord, type ServerRecord } from "./types.ts";

type CraftState = {
  theme: "dark" | "light";
  settings: AppSettings;
  servers: ServerRecord[];
  plays: PlayRecord[];
  jobs: DownloadJob[];
  activity: Activity[];
  runtimes: RuntimeRecord[];
  setTheme: (theme: "dark" | "light") => void;
  setSettings: (patch: Partial<AppSettings>) => void;
  addServer: (server: ServerRecord) => void;
  updateServer: (id: string, patch: Partial<ServerRecord> | ((server: ServerRecord) => ServerRecord)) => void;
  removeServer: (id: string) => void;
  addPlay: (play: PlayRecord) => void;
  updatePlay: (id: string, patch: Partial<PlayRecord> | ((play: PlayRecord) => PlayRecord)) => void;
  removePlay: (id: string) => void;
  upsertJob: (job: DownloadJob) => void;
  pushActivity: (text: string, serverId?: string) => void;
  addRuntime: (runtime: RuntimeRecord) => void;
  removeRuntime: (id: string) => void;
};

const defaultSettings: AppSettings = { curseforgeKey: "", backupKeep: 8, allowUnlistedHosts: false };

export const useCraft = create<CraftState>()(
  persist(
    (set) => ({
      theme: "dark",
      settings: defaultSettings,
      servers: [],
      plays: [],
      jobs: [],
      activity: [],
      runtimes: [],
      setTheme: (theme) => set({ theme }),
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      addServer: (server) => set((s) => ({ servers: [server, ...s.servers] })),
      updateServer: (id, patch) =>
        set((s) => ({
          servers: s.servers.map((server) => {
            if (server.id !== id) return server;
            const next = typeof patch === "function" ? patch(server) : { ...server, ...patch };
            return { ...next, updatedAt: Date.now() };
          }),
        })),
      removeServer: (id) => set((s) => ({ servers: s.servers.filter((server) => server.id !== id) })),
      addPlay: (play) => set((s) => ({ plays: [play, ...(s.plays ?? [])] })),
      updatePlay: (id, patch) =>
        set((s) => ({
          plays: (s.plays ?? []).map((play) => {
            if (play.id !== id) return play;
            const next = typeof patch === "function" ? patch(play) : { ...play, ...patch };
            return { ...next, updatedAt: Date.now() };
          }),
        })),
      removePlay: (id) => set((s) => ({ plays: (s.plays ?? []).filter((play) => play.id !== id) })),
      upsertJob: (job) =>
        set((s) => {
          const rest = s.jobs.filter((item) => item.id !== job.id);
          return { jobs: [job, ...rest].slice(0, 40) };
        }),
      pushActivity: (text, serverId) =>
        set((s) => ({
          activity: [{ id: crypto.randomUUID(), at: Date.now(), text, serverId }, ...s.activity].slice(0, 40),
        })),
      addRuntime: (runtime) =>
        set((s) => ({ runtimes: [runtime, ...s.runtimes.filter((r) => r.id !== runtime.id)].slice(0, 20) })),
      removeRuntime: (id) => set((s) => ({ runtimes: s.runtimes.filter((r) => r.id !== id) })),
    }),
    {
      name: "craftserver",
      skipHydration: true,
      partialize: (s) => ({
        theme: s.theme,
        settings: s.settings,
        servers: s.servers,
        plays: s.plays,
        jobs: s.jobs,
        activity: s.activity,
        runtimes: s.runtimes,
      }),
    },
  ),
);

export function freshStages() {
  return STAGE_DEFS.map((stage) => ({ ...stage }));
}

export function snapshot(server: ServerRecord, reason: BackupSnap["reason"], label: string): BackupSnap {
  return {
    id: crypto.randomUUID(),
    at: Date.now(),
    reason,
    label,
    minecraftVersion: server.minecraftVersion,
    loader: server.loader,
    loaderVersion: server.loaderVersion,
    version: server.pack.version,
    ramMinMb: server.ramMinMb,
    ramMaxMb: server.ramMaxMb,
    port: server.port,
    maxPlayers: server.maxPlayers,
    motd: server.motd,
    difficulty: server.difficulty,
    gamemode: server.gamemode,
    viewDistance: server.viewDistance,
    simulationDistance: server.simulationDistance,
    onlineMode: server.onlineMode,
    pvp: server.pvp,
    whitelist: server.whitelist,
    commandBlocks: server.commandBlocks,
    extraJvm: server.extraJvm,
    gc: server.gc,
    files: server.files,
  };
}

export function pushBackup(server: ServerRecord, snap: BackupSnap): BackupSnap[] {
  const keep = useCraft.getState().settings.backupKeep || 8;
  return [snap, ...server.backups].slice(0, keep);
}

export function slugName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "server";
}

export function applyRam(server: Pick<ServerRecord, "files" | "minecraftVersion">) {
  return recommendRam(server.files, server.minecraftVersion);
}

export function logLine(level: LogLine["level"], text: string): LogLine {
  return { id: crypto.randomUUID(), t: Date.now(), level, text };
}

export function includedMods(files: PackFile[]) {
  return files.filter((f) => f.included && f.path.startsWith("mods/") && f.path.endsWith(".jar"));
}
