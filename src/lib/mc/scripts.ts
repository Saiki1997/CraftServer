import type { ServerRecord } from "./types.ts";

function props(server: ServerRecord): Record<string, string> {
  return {
    "server-ip": server.bindIp.trim(),
    "server-port": String(server.port),
    "max-players": String(server.maxPlayers),
    "online-mode": String(server.onlineMode),
    difficulty: server.difficulty,
    gamemode: server.gamemode,
    "view-distance": String(server.viewDistance),
    "simulation-distance": String(server.simulationDistance),
    motd: server.motd.replace(/\r?\n/g, ""),
    pvp: String(server.pvp),
    "enable-command-block": String(server.commandBlocks),
    "white-list": String(server.whitelist),
    "enforce-whitelist": String(server.whitelist),
    "enable-rcon": String(server.rconEnabled),
    "rcon.port": String(server.rconPort),
    "rcon.password": server.rconEnabled ? server.rconPassword : "",
    "spawn-protection": "16",
    "max-tick-time": "60000",
  };
}

export function serverProperties(server: ServerRecord): string {
  return (
    Object.entries(props(server))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
}

export function jvmFile(server: ServerRecord): string {
  const extra = server.gc === "g1" ? server.extraJvm.trim() : server.extraJvm.trim();
  return extra ? `${extra}\n` : "# No extra JVM flags.\n";
}

function javaHome(server: ServerRecord): string {
  if (server.manualJavaPath.trim()) return server.manualJavaPath.trim();
  return `runtime\\java${server.javaMajor}`;
}

function javaBin(server: ServerRecord): string {
  if (server.manualJavaPath.trim()) {
    const p = server.manualJavaPath.trim().replace(/[/\\]+$/, "");
    return p.toLowerCase().endsWith("java.exe") ? p : `${p}\\bin\\java.exe`;
  }
  return `runtime\\java${server.javaMajor}\\bin\\java.exe`;
}

export function startBat(server: ServerRecord): string {
  const home = javaHome(server);
  const bin = javaBin(server);
  return [
    "@echo off",
    "setlocal",
    'cd /d "%~dp0"',
    `set "JAVA_HOME=${home}"`,
    'set "PATH=%JAVA_HOME%\\bin;%PATH%"',
    "if exist \"run.bat\" (",
    "  call run.bat nogui",
    "  exit /b %ERRORLEVEL%",
    ")",
    `if not exist "${bin}" (`,
    "  echo Java was not found. Run install.ps1 first, or set a manual Java path in CraftServer.",
    "  exit /b 1",
    ")",
    `"${bin}" -Xms${server.ramMinMb}M -Xmx${server.ramMaxMb}M @craftserver-jvm.txt -jar server.jar nogui`,
    "exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n");
}

export function startSh(server: ServerRecord): string {
  const major = server.javaMajor;
  return [
    "#!/bin/sh",
    "cd \"$(dirname \"$0\")\" || exit 1",
    "if [ -n \"$CRAFTSERVER_JAVA\" ]; then",
    "  JAVA=\"$CRAFTSERVER_JAVA\"",
    "else",
    `  JAVA=\"runtime/java${major}/bin/java\"`,
    "fi",
    "if [ -f run.sh ]; then",
    "  JAVA_HOME=\"$(dirname \"$(dirname \"$JAVA\")\")\"",
    "  export JAVA_HOME",
    "  export PATH=\"$JAVA_HOME/bin:$PATH\"",
    "  exec sh run.sh nogui",
    "fi",
    "if [ ! -x \"$JAVA\" ]; then",
    "  echo \"Java was not found. Run install.ps1 or export CRAFTSERVER_JAVA.\"",
    "  exit 1",
    "fi",
    `exec \"$JAVA\" -Xms${server.ramMinMb}M -Xmx${server.ramMaxMb}M @craftserver-jvm.txt -jar server.jar nogui`,
    "",
  ].join("\n");
}

export function installPs1(server: ServerRecord): string {
  const plan = server.plan;
  const win = plan?.builds.windows;
  const lines: string[] = [
    "$ErrorActionPreference = 'Stop'",
    "Set-Location -LiteralPath $PSScriptRoot",
    "function Get-File([string]$Url, [string]$Dest, [string]$Sha1) {",
    "  $dir = Split-Path -Parent $Dest",
    "  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }",
    "  if ((Test-Path -LiteralPath $Dest) -and $Sha1) {",
    "    $algo = $(if ($Sha1.Length -eq 64) { 'SHA256' } else { 'SHA1' })",
    "    $have = (Get-FileHash -LiteralPath $Dest -Algorithm $algo).Hash.ToLower()",
    "    if ($have -eq $Sha1.ToLower()) { return }",
    "  }",
    "  $attempt = 0",
    "  while ($true) {",
    "    $attempt++",
    "    & curl.exe -L --fail --retry 3 --retry-all-errors -C - -A 'CraftServer/1.0' -o $Dest $Url",
    "    if ($LASTEXITCODE -eq 0) { break }",
    "    if ($attempt -ge 4) { throw \"Download failed: $Url\" }",
    "    Start-Sleep -Seconds (2 * $attempt)",
    "  }",
    "  if ($Sha1) {",
    "    $algo = $(if ($Sha1.Length -eq 64) { 'SHA256' } else { 'SHA1' })",
    "    $have = (Get-FileHash -LiteralPath $Dest -Algorithm $algo).Hash.ToLower()",
    "    if ($have -ne $Sha1.ToLower()) { throw \"Hash mismatch for $Dest\" }",
    "  }",
    "}",
    "function Expand-Safe([string]$Zip, [string]$Dest) {",
    "  Add-Type -AssemblyName System.IO.Compression.FileSystem",
    "  $archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Zip))",
    "  try {",
    "    foreach ($entry in $archive.Entries) {",
    "      $name = $entry.FullName.Replace('\\','/')",
    "      if ($name.StartsWith('/') -or $name.Split('/') -contains '..') { throw \"Unsafe path $name\" }",
    "      if ($name.EndsWith('/')) { continue }",
    "      $target = Join-Path $Dest ($name -replace '/','\\')",
    "      $parent = Split-Path -Parent $target",
    "      if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }",
    "      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)",
    "    }",
    "  } finally { $archive.Dispose() }",
    "}",
  ];
  if (win && !server.manualJavaPath.trim()) {
    lines.push(
      `$javaExe = Join-Path $PSScriptRoot 'runtime\\java${server.javaMajor}\\bin\\java.exe'`,
      "if (-not (Test-Path -LiteralPath $javaExe)) {",
      `  Get-File '${win.url.replace(/'/g, "''")}' (Join-Path $PSScriptRoot 'runtime\\temurin.zip') '${win.checksum ?? ""}'`,
      `  Expand-Safe (Join-Path $PSScriptRoot 'runtime\\temurin.zip') (Join-Path $PSScriptRoot 'runtime\\_jre')`,
      "  $inner = Get-ChildItem (Join-Path $PSScriptRoot 'runtime\\_jre') -Directory | Select-Object -First 1",
      `  $dest = Join-Path $PSScriptRoot 'runtime\\java${server.javaMajor}'`,
      "  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }",
      "  Move-Item $inner.FullName $dest",
      "}",
    );
  }
  if (server.pack.officialServerPack && server.pack.archiveUrl) {
    lines.push(
      `Get-File '${server.pack.archiveUrl.replace(/'/g, "''")}' (Join-Path $PSScriptRoot 'server-pack.zip') ''`,
      "Expand-Safe (Join-Path $PSScriptRoot 'server-pack.zip') $PSScriptRoot",
    );
  }
  if (plan?.loader.url && server.loader !== "vanilla") {
    const name = plan.loader.filename || "loader-installer.jar";
    lines.push(
      `Get-File '${plan.loader.url.replace(/'/g, "''")}' (Join-Path $PSScriptRoot '${name}') ''`,
    );
    if (server.loader === "fabric" || server.loader === "quilt") {
      lines.push(`if (-not (Test-Path server.jar)) { Copy-Item '${name}' server.jar }`);
    } else {
      lines.push(
        `$env:JAVA_HOME = (Resolve-Path (Join-Path $PSScriptRoot 'runtime\\java${server.javaMajor}') -ErrorAction SilentlyContinue)`,
        "if ($env:JAVA_HOME) { $env:Path = \"$env:JAVA_HOME\\bin;\" + $env:Path }",
        `& java -jar '${name}' --installServer`,
      );
    }
  } else if (plan?.vanilla?.url && server.loader === "vanilla") {
    lines.push(
      `Get-File '${plan.vanilla.url.replace(/'/g, "''")}' (Join-Path $PSScriptRoot 'server.jar') '${plan.vanilla.checksum ?? ""}'`,
    );
  }
  const preserve = new Set([
    "server.properties",
    "eula.txt",
    "ops.json",
    "whitelist.json",
    "banned-players.json",
    "banned-ips.json",
    "usercache.json",
  ]);
  for (const file of server.files) {
    if (!file.included || !file.url || file.contained) continue;
    if (file.path.split("/").some((p) => p === "..")) continue;
    const top = file.path.split("/")[0];
    if (top === "world" || top === "worlds") continue;
    if (preserve.has(file.path)) continue;
    const dest = file.path.replace(/\//g, "\\");
    const sha = file.sha1 ?? "";
    lines.push(`Get-File '${file.url.replace(/'/g, "''")}' (Join-Path $PSScriptRoot '${dest}') '${sha}'`);
  }
  lines.push(
    "if (-not (Test-Path -LiteralPath 'server.properties')) {",
    "  Write-Host 'server.properties is missing. Export again from CraftServer.'",
    "}",
    "Write-Host 'Install pass finished. World, ops, whitelist, and existing server.properties were not replaced.'",
  );
  return lines.join("\r\n") + "\r\n";
}

export function launchCommand(server: ServerRecord): string {
  const bin = server.manualJavaPath.trim()
    ? server.manualJavaPath.trim()
    : `runtime/java${server.javaMajor}/bin/java`;
  if (server.loader === "forge" || server.loader === "neoforge") {
    return `${bin} -Xms${server.ramMinMb}M -Xmx${server.ramMaxMb}M @craftserver-jvm.txt (Forge/NeoForge: run install.ps1, then start.bat which calls run.bat)`;
  }
  return `${bin} -Xms${server.ramMinMb}M -Xmx${server.ramMaxMb}M @craftserver-jvm.txt -jar server.jar nogui`;
}
