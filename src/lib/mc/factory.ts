import { recommendRam } from "./recommend.ts";
import { freshStages, slugName } from "./store.ts";
import type { DetectedPack, ServerRecord } from "./types.ts";

export function makeServer(
  pack: DetectedPack,
  input: { name: string; port: number; ramMinMb: number; ramMaxMb: number; excludeClient: boolean },
  takenPorts: number[],
): ServerRecord {
  const advice = recommendRam(pack.files, pack.minecraftVersion);
  let port = input.port || 25565;
  while (takenPorts.includes(port)) port += 1;
  const id = crypto.randomUUID();
  const files = pack.files.map((file) =>
    input.excludeClient && file.clientOnly ? { ...file, included: false } : { ...file },
  );
  return {
    id,
    name: input.name.trim() || pack.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastPlayed: null,
    status: "stopped",
    directoryLabel: `servers/${slugName(input.name || pack.name)}-${id.slice(0, 6)}`,
    pack,
    minecraftVersion: pack.minecraftVersion,
    loader: pack.loader,
    loaderVersion: pack.loaderVersion,
    javaMajor: pack.javaMajor,
    javaSource: pack.javaSource,
    javaNote: pack.javaNote,
    runtimeId: null,
    manualJavaPath: "",
    ramMinMb: input.ramMinMb || advice.minMb,
    ramMaxMb: input.ramMaxMb || advice.maxMb,
    port,
    maxPlayers: 20,
    onlineMode: true,
    difficulty: "normal",
    gamemode: "survival",
    viewDistance: 10,
    simulationDistance: 10,
    motd: pack.name,
    pvp: true,
    commandBlocks: true,
    whitelist: false,
    rconEnabled: false,
    rconPort: port + 10 > 65535 ? port - 1 : port + 10,
    rconPassword: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    bindIp: "",
    gc: "default",
    extraJvm: "",
    eulaAccepted: false,
    files,
    installStages: freshStages(),
    console: [],
    commandHistory: [],
    queuedCommands: [],
    backups: [],
    removedClientByDefault: input.excludeClient,
  };
}
