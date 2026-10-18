import { resolveServerPlan } from "./api.ts";
import { safeRelPath } from "./classify.ts";
import { freshStages, logLine, pushBackup, snapshot, useCraft } from "./store.ts";
import type { InstallStage, ServerRecord } from "./types.ts";

const aborters = new Map<string, AbortController>();

function job(serverId: string, stage: string, status: "active" | "done" | "failed" | "cancelled", progress: number, attempts: number, error?: string) {
  useCraft.getState().upsertJob({
    id: `install-${serverId}`,
    serverId,
    name: useCraft.getState().servers.find((s) => s.id === serverId)?.name ?? "Server",
    stage,
    status,
    progress,
    attempts,
    error,
    updatedAt: Date.now(),
  });
}

function setStages(server: ServerRecord, id: InstallStage["id"], state: InstallStage["state"], detail?: string): InstallStage[] {
  return server.installStages.map((stage) => (stage.id === id ? { ...stage, state, detail } : stage));
}

export function cancelInstall(serverId: string) {
  aborters.get(serverId)?.abort();
}

export async function runInstall(serverId: string) {
  const existing = aborters.get(serverId);
  existing?.abort();
  const controller = new AbortController();
  aborters.set(serverId, controller);
  const started = useCraft.getState().servers.find((s) => s.id === serverId);
  if (!started) return;
  let attempts = (useCraft.getState().jobs.find((j) => j.id === `install-${serverId}`)?.attempts ?? 0) + 1;
  const order: InstallStage["id"][] = ["classify", "java", "loader", "config", "verify"];
  try {
    for (const id of order) {
      if (controller.signal.aborted) throw new Error("cancelled");
      const current = useCraft.getState().servers.find((s) => s.id === serverId);
      if (!current) return;
      const stage = current.installStages.find((item) => item.id === id);
      if (stage?.state === "done") continue;
      useCraft.getState().updateServer(serverId, { installStages: setStages(current, id, "running"), installError: undefined });
      job(serverId, stage?.label ?? id, "active", Math.round((order.indexOf(id) / order.length) * 100), attempts);
      if (id === "classify") classify(current);
      if (id === "java" || id === "loader") {
        if (id === "loader" && current.plan?.loader) {
          if (current.loader !== "vanilla" && current.loader !== "unknown" && !current.plan.loader.url) {
            throw new Error(current.plan.loader.note || "Loader installer is missing.");
          }
        } else if (id === "java") {
          const plan = await resolveServerPlan({
            data: {
              minecraftVersion: current.minecraftVersion,
              loader: current.loader,
              loaderVersion: current.loaderVersion,
            },
            signal: controller.signal,
          });
          const fresh = useCraft.getState().servers.find((s) => s.id === serverId);
          if (!fresh) return;
          useCraft.getState().updateServer(serverId, {
            plan,
            javaMajor: plan.javaMajor,
            javaSource: plan.javaSource,
            javaNote: plan.javaNote,
          });
          const runtimeId = fresh.runtimeId;
          if (!runtimeId) {
            const runtime = {
              id: crypto.randomUUID(),
              major: plan.javaMajor,
              vendor: "temurin" as const,
              label: `Temurin ${plan.javaMajor}`,
              path: `runtime/java${plan.javaMajor}`,
              builds: plan.builds,
              verified: true,
              note: plan.javaNote,
            };
            useCraft.getState().addRuntime(runtime);
            useCraft.getState().updateServer(serverId, { runtimeId: runtime.id });
          }
          if (current.loader !== "vanilla" && current.loader !== "unknown" && !plan.loader.url) {
            useCraft.getState().updateServer(serverId, {
              installStages: setStages(useCraft.getState().servers.find((s) => s.id === serverId)!, "java", "done", plan.javaNote),
            });
            throw new Error(plan.loader.note || "Loader installer could not be verified.");
          }
        }
      }
      if (id === "config") {
        if (!current.motd.trim()) throw new Error("MOTD is empty.");
      }
      if (id === "verify") verify(useCraft.getState().servers.find((s) => s.id === serverId)!);
      const after = useCraft.getState().servers.find((s) => s.id === serverId)!;
      useCraft.getState().updateServer(serverId, {
        installStages: setStages(after, id, "done"),
      });
    }
    const done = useCraft.getState().servers.find((s) => s.id === serverId)!;
    useCraft.getState().updateServer(serverId, {
      installedAt: Date.now(),
      installError: undefined,
      backups: pushBackup(done, snapshot(done, "manual", "Install verified")),
      console: [
        ...done.console,
        logLine("system", "Install verified. The Java process is not started in this preview."),
        logLine("system", "Download the server folder and run install.ps1, then start.bat, on your computer."),
      ].slice(-400),
    });
    job(serverId, "Verified", "done", 100, attempts);
    useCraft.getState().pushActivity(`Verified ${done.name}`, serverId);
  } catch (err) {
    if (controller.signal.aborted || (err instanceof Error && err.message === "cancelled")) {
      job(serverId, "Cancelled", "cancelled", 0, attempts);
      return;
    }
    const message = err instanceof Error ? err.message : "Install failed.";
    const current = useCraft.getState().servers.find((s) => s.id === serverId);
    if (current) {
      const running = current.installStages.find((stage) => stage.state === "running");
      useCraft.getState().updateServer(serverId, {
        installError: message,
        installStages: running ? setStages(current, running.id, "failed", message) : current.installStages,
      });
      job(serverId, running?.label ?? "Install", "failed", 0, attempts, message);
    }
  } finally {
    if (aborters.get(serverId) === controller) aborters.delete(serverId);
  }
}

function classify(server: ServerRecord) {
  for (const file of server.files) {
    if (!safeRelPath(file.path)) throw new Error(`Unsafe path blocked: ${file.path}`);
  }
  if (server.loader === "unknown") {
    throw new Error("Mod loader is unknown. Set it from the server settings before install. Nothing was marked successful.");
  }
}

function verify(server: ServerRecord) {
  if (!server.minecraftVersion || server.minecraftVersion === "unknown") {
    throw new Error("Minecraft version is missing.");
  }
  if (!server.plan?.builds.windows && !server.plan?.builds.linux && !server.manualJavaPath.trim()) {
    throw new Error("No Java runtime was resolved.");
  }
  if (server.loader === "vanilla" && !server.plan?.vanilla?.url) {
    throw new Error("Vanilla server jar URL is missing.");
  }
  if ((server.loader === "forge" || server.loader === "neoforge" || server.loader === "fabric" || server.loader === "quilt") && !server.plan?.loader.url && !server.pack.archiveUrl) {
    throw new Error(server.plan?.loader.note || "Loader installer URL is missing.");
  }
  const needed = server.files.filter((f) => f.included && !f.contained);
  const missing = needed.filter((f) => !f.url && f.path.startsWith("mods/"));
  if (server.pack.installMode !== "server-pack" && missing.length) {
    throw new Error(`${missing.length} included mods have no download URL. Installation was not marked successful.`);
  }
  if (server.pack.installMode === "manual" && server.files.filter((f) => f.included).length === 0 && server.loader !== "vanilla") {
    throw new Error("This source did not provide server files. Installation was not marked successful.");
  }
  if (server.port < 1 || server.port > 65535) throw new Error("Server port is invalid.");
}

export function resetFailed(serverId: string) {
  const server = useCraft.getState().servers.find((s) => s.id === serverId);
  if (!server) return;
  useCraft.getState().updateServer(serverId, {
    installError: undefined,
    installStages: server.installStages.some((s) => s.id) ? server.installStages.map((s) => (s.state === "failed" || s.state === "running" ? { ...s, state: "pending", detail: undefined } : s)) : freshStages(),
  });
}
