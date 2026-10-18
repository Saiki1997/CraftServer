import { resolveServerPlan } from "./api.ts";
import { safeRelPath } from "./classify.ts";
import { logLine, useCraft } from "./store.ts";
import type { InstallStage, PlayRecord } from "./types.ts";

const aborters = new Map<string, AbortController>();

function job(playId: string, stage: string, status: "active" | "done" | "failed" | "cancelled", progress: number, attempts: number, error?: string) {
  useCraft.getState().upsertJob({
    id: `install-${playId}`,
    serverId: playId,
    name: useCraft.getState().plays.find((p) => p.id === playId)?.name ?? "Instance",
    stage,
    status,
    progress,
    attempts,
    error,
    updatedAt: Date.now(),
  });
}

function setStages(play: PlayRecord, id: InstallStage["id"], state: InstallStage["state"], detail?: string): InstallStage[] {
  return play.installStages.map((stage) => (stage.id === id ? { ...stage, state, detail } : stage));
}

export function cancelPlayInstall(playId: string) {
  aborters.get(playId)?.abort();
}

export async function runPlayInstall(playId: string) {
  const existing = aborters.get(playId);
  existing?.abort();
  const controller = new AbortController();
  aborters.set(playId, controller);
  const started = useCraft.getState().plays.find((p) => p.id === playId);
  if (!started) return;
  let attempts = (useCraft.getState().jobs.find((j) => j.id === `install-${playId}`)?.attempts ?? 0) + 1;
  const order: InstallStage["id"][] = ["classify", "java", "loader", "config", "verify"];
  try {
    for (const id of order) {
      if (controller.signal.aborted) throw new Error("cancelled");
      const current = useCraft.getState().plays.find((p) => p.id === playId);
      if (!current) return;
      const stage = current.installStages.find((item) => item.id === id);
      if (stage?.state === "done") continue;
      useCraft.getState().updatePlay(playId, { installStages: setStages(current, id, "running"), installError: undefined });
      job(playId, stage?.label ?? id, "active", Math.round((order.indexOf(id) / order.length) * 100), attempts);
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
          const fresh = useCraft.getState().plays.find((p) => p.id === playId);
          if (!fresh) return;
          useCraft.getState().updatePlay(playId, {
            plan,
            javaMajor: plan.javaMajor,
            javaSource: plan.javaSource,
            javaNote: plan.javaNote,
          });
          if (!fresh.runtimeId) {
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
            useCraft.getState().updatePlay(playId, { runtimeId: runtime.id });
          }
          if (current.loader !== "vanilla" && current.loader !== "unknown" && !plan.loader.url) {
            const now = useCraft.getState().plays.find((p) => p.id === playId);
            if (now) useCraft.getState().updatePlay(playId, { installStages: setStages(now, "java", "done", plan.javaNote) });
            throw new Error(plan.loader.note || "Loader installer could not be verified.");
          }
        }
      }
      if (id === "config") {
        const live = useCraft.getState().plays.find((p) => p.id === playId);
        if (!live || live.width < 640 || live.height < 360) throw new Error("Window size is too small.");
      }
      if (id === "verify") verify(useCraft.getState().plays.find((p) => p.id === playId)!);
      const after = useCraft.getState().plays.find((p) => p.id === playId)!;
      useCraft.getState().updatePlay(playId, { installStages: setStages(after, id, "done") });
    }
    const done = useCraft.getState().plays.find((p) => p.id === playId)!;
    useCraft.getState().updatePlay(playId, {
      installedAt: Date.now(),
      installError: undefined,
      console: [
        ...done.console,
        logLine("system", "Play instance verified. Minecraft is not started in this preview."),
        logLine("system", "Download the instance folder and run install.ps1 on your computer. A Microsoft account is still required to play, and this app does not collect one."),
      ].slice(-400),
    });
    job(playId, "Verified", "done", 100, attempts);
    useCraft.getState().pushActivity(`Verified play instance ${done.name}`, playId);
  } catch (err) {
    if (controller.signal.aborted || (err instanceof Error && err.message === "cancelled")) {
      job(playId, "Cancelled", "cancelled", 0, attempts);
      return;
    }
    const message = err instanceof Error ? err.message : "Install failed.";
    const current = useCraft.getState().plays.find((p) => p.id === playId);
    if (current) {
      const running = current.installStages.find((stage) => stage.state === "running");
      useCraft.getState().updatePlay(playId, {
        installError: message,
        installStages: running ? setStages(current, running.id, "failed", message) : current.installStages,
      });
      job(playId, running?.label ?? "Install", "failed", 0, attempts, message);
    }
  } finally {
    if (aborters.get(playId) === controller) aborters.delete(playId);
  }
}

export function resetPlayFailed(playId: string) {
  const play = useCraft.getState().plays.find((p) => p.id === playId);
  if (!play) return;
  useCraft.getState().updatePlay(playId, {
    installError: undefined,
    installStages: play.installStages.map((stage) => (stage.state === "failed" ? { ...stage, state: "pending", detail: undefined } : stage)),
  });
}

function classify(play: PlayRecord) {
  for (const file of play.files) {
    if (!safeRelPath(file.path)) throw new Error(`Unsafe path blocked: ${file.path}`);
  }
  if (play.loader === "unknown") {
    throw new Error("Mod loader is unknown. Nothing was marked successful.");
  }
}

function verify(play: PlayRecord) {
  if (!play.minecraftVersion || play.minecraftVersion === "unknown") throw new Error("Minecraft version is missing.");
  if (!play.plan?.builds.windows && !play.plan?.builds.linux && !play.manualJavaPath.trim()) {
    throw new Error("No Java runtime was resolved.");
  }
  if (!play.plan?.client?.url) throw new Error("Mojang did not publish a client jar for this version.");
  if ((play.loader === "forge" || play.loader === "neoforge" || play.loader === "fabric" || play.loader === "quilt") && !play.plan?.loader.url && !play.pack.archiveUrl) {
    throw new Error(play.plan?.loader.note || "Loader installer URL is missing.");
  }
}
