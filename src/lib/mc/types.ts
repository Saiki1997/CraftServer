export type LoaderKind =
  | "forge"
  | "neoforge"
  | "fabric"
  | "quilt"
  | "vanilla"
  | "legacy-fabric"
  | "unknown";

export type PackSource =
  | "modrinth"
  | "curseforge"
  | "ftb"
  | "technic"
  | "atlauncher"
  | "github"
  | "zip"
  | "direct";

export type InstallMode = "server-pack" | "metadata-files" | "manual";

export type FileSide = "client" | "server" | "both" | "unknown";

export type PackFile = {
  path: string;
  url?: string;
  sha1?: string;
  sha512?: string;
  size?: number;
  side: FileSide;
  required: boolean;
  clientOnly: boolean;
  serverOnly: boolean;
  uncertain: boolean;
  included: boolean;
  contained?: boolean;
  note?: string;
};

export type SourceRef = {
  provider: PackSource;
  projectId?: string;
  versionId?: string;
  slug?: string;
  pageUrl?: string;
};

export type DetectedPack = {
  source: PackSource;
  sourceLabel: string;
  name: string;
  author: string;
  summary: string;
  version: string;
  iconUrl?: string;
  pageUrl?: string;
  minecraftVersion: string;
  loader: LoaderKind;
  loaderVersion: string;
  javaMajor: number;
  javaSource: "mojang-metadata" | "pack" | "compatibility-table";
  javaNote: string;
  officialServerPack: boolean;
  serverPackNote: string;
  installMode: InstallMode;
  files: PackFile[];
  warnings: string[];
  sourceRef: SourceRef;
  archiveUrl?: string;
};

export type RuntimeAsset = {
  url: string;
  filename: string;
  checksum?: string;
  size?: number;
};

export type InstallPlan = {
  javaMajor: number;
  javaSource: DetectedPack["javaSource"];
  javaNote: string;
  builds: { windows?: RuntimeAsset; linux?: RuntimeAsset; mac?: RuntimeAsset };
  loader: { url?: string; filename: string; note: string };
  vanilla?: RuntimeAsset;
  verifiedAt: number;
};

export type StageState = "pending" | "running" | "done" | "failed" | "skipped";

export type InstallStage = {
  id: "classify" | "java" | "loader" | "config" | "verify";
  label: string;
  state: StageState;
  detail?: string;
};

export type LogLevel = "info" | "warn" | "error" | "system" | "in";

export type LogLine = { id: string; t: number; level: LogLevel; text: string };

export type BackupSnap = {
  id: string;
  at: number;
  reason: "manual" | "update" | "edit" | "restore-point";
  label: string;
  minecraftVersion: string;
  loader: LoaderKind;
  loaderVersion: string;
  version: string;
  ramMinMb: number;
  ramMaxMb: number;
  port: number;
  maxPlayers: number;
  motd: string;
  difficulty: string;
  gamemode: string;
  viewDistance: number;
  simulationDistance: number;
  onlineMode: boolean;
  pvp: boolean;
  whitelist: boolean;
  commandBlocks: boolean;
  extraJvm: string;
  gc: "g1" | "default";
  files: PackFile[];
};

export type ServerStatus = "stopped" | "running" | "crashed";

export type ServerRecord = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastPlayed: number | null;
  status: ServerStatus;
  directoryLabel: string;
  pack: DetectedPack;
  minecraftVersion: string;
  loader: LoaderKind;
  loaderVersion: string;
  javaMajor: number;
  javaSource: DetectedPack["javaSource"];
  javaNote: string;
  runtimeId: string | null;
  manualJavaPath: string;
  ramMinMb: number;
  ramMaxMb: number;
  port: number;
  maxPlayers: number;
  onlineMode: boolean;
  difficulty: "peaceful" | "easy" | "normal" | "hard";
  gamemode: "survival" | "creative" | "adventure" | "spectator";
  viewDistance: number;
  simulationDistance: number;
  motd: string;
  pvp: boolean;
  commandBlocks: boolean;
  whitelist: boolean;
  rconEnabled: boolean;
  rconPort: number;
  rconPassword: string;
  bindIp: string;
  gc: "g1" | "default";
  extraJvm: string;
  eulaAccepted: boolean;
  files: PackFile[];
  installStages: InstallStage[];
  installError?: string;
  installedAt?: number;
  plan?: InstallPlan;
  console: LogLine[];
  commandHistory: string[];
  queuedCommands: string[];
  backups: BackupSnap[];
  removedClientByDefault: boolean;
};

export type RuntimeRecord = {
  id: string;
  major: number;
  vendor: "temurin" | "manual";
  label: string;
  path: string;
  builds?: InstallPlan["builds"];
  verified: boolean;
  note: string;
};

export type JobStatus = "queued" | "active" | "done" | "failed" | "cancelled";

export type DownloadJob = {
  id: string;
  serverId?: string;
  name: string;
  stage: string;
  status: JobStatus;
  progress: number;
  attempts: number;
  error?: string;
  updatedAt: number;
};

export type Activity = { id: string; at: number; text: string; serverId?: string };

export type AppSettings = {
  curseforgeKey: string;
  backupKeep: number;
  allowUnlistedHosts: boolean;
};

export const STAGE_DEFS: InstallStage[] = [
  { id: "classify", label: "Classify server files", state: "pending" },
  { id: "java", label: "Resolve Java runtime", state: "pending" },
  { id: "loader", label: "Resolve mod loader", state: "pending" },
  { id: "config", label: "Write server configuration", state: "pending" },
  { id: "verify", label: "Verify installation", state: "pending" },
];
