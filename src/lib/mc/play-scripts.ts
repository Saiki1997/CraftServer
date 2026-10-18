import type { PlayRecord } from "./types.ts";

function q(value: string): string {
  return value.replace(/'/g, "''");
}

function versionToken(value: string): string {
  return /^[0-9A-Za-z._+-]{1,48}$/.test(value) ? value : "";
}

export function playInstallPs1(play: PlayRecord): string {
  const plan = play.plan;
  const win = plan?.builds.windows;
  const mc = versionToken(play.minecraftVersion);
  const loaderVer = versionToken(play.loaderVersion);
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
    "    & curl.exe -L --fail --retry 3 --retry-all-errors -C - -A 'Craft/1.0' -o $Dest $Url",
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
  ];
  if (win && !play.manualJavaPath.trim()) {
    lines.push(
      `$javaExe = Join-Path $PSScriptRoot 'runtime\\java${play.javaMajor}\\bin\\java.exe'`,
      "if (-not (Test-Path -LiteralPath $javaExe)) {",
      `  Get-File '${q(win.url)}' (Join-Path $PSScriptRoot 'runtime\\temurin.zip') '${win.checksum ?? ""}'`,
      "  Expand-Archive -LiteralPath (Join-Path $PSScriptRoot 'runtime\\temurin.zip') -DestinationPath (Join-Path $PSScriptRoot 'runtime\\_jre') -Force",
      "  $inner = Get-ChildItem (Join-Path $PSScriptRoot 'runtime\\_jre') -Directory | Select-Object -First 1",
      `  $dest = Join-Path $PSScriptRoot 'runtime\\java${play.javaMajor}'`,
      "  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }",
      "  Move-Item $inner.FullName $dest",
      "}",
    );
  }
  if (plan?.client?.url) {
    lines.push(`Get-File '${q(plan.client.url)}' (Join-Path $PSScriptRoot 'client.jar') '${plan.client.checksum ?? ""}'`);
  }
  if (plan?.loader.url && play.loader !== "vanilla") {
    const name = plan.loader.filename || "loader-installer.jar";
    lines.push(`Get-File '${q(plan.loader.url)}' (Join-Path $PSScriptRoot '${name.replace(/'/g, "")}') ''`);
    if (play.loader === "forge" || play.loader === "neoforge") {
      lines.push(
        `$env:JAVA_HOME = Join-Path $PSScriptRoot 'runtime\\java${play.javaMajor}'`,
        "if (Test-Path $env:JAVA_HOME) { $env:Path = \"$env:JAVA_HOME\\bin;\" + $env:Path }",
        `& java -jar '${name.replace(/'/g, "")}' --installClient`,
      );
    }
  }
  if ((play.loader === "fabric" || play.loader === "quilt") && mc && loaderVer) {
    const profile = play.loader === "quilt"
      ? `https://meta.quiltmc.org/v3/versions/loader/${mc}/${loaderVer}/profile/json`
      : `https://meta.fabricmc.net/v2/versions/loader/${mc}/${loaderVer}/profile/json`;
    lines.push(`Get-File '${profile}' (Join-Path $PSScriptRoot 'loader-profile.json') ''`);
  }
  for (const file of play.files) {
    if (!file.included || !file.url || file.contained) continue;
    if (file.path.split("/").some((part) => part === "..")) continue;
    const dest = file.path.replace(/\//g, "\\");
    lines.push(`Get-File '${q(file.url)}' (Join-Path $PSScriptRoot '${dest.replace(/'/g, "")}') '${file.sha1 ?? ""}'`);
  }
  lines.push("Write-Host 'Play instance files are in this folder. Minecraft was not started. A Microsoft account is required to play, and this script does not collect one.'");
  return lines.join("\r\n") + "\r\n";
}

export function playStartBat(play: PlayRecord): string {
  return [
    "@echo off",
    "setlocal",
    'cd /d "%~dp0"',
    "if not exist client.jar (",
    "  echo Run install.ps1 first.",
    "  exit /b 1",
    ")",
    `echo ${play.name}`,
    `echo Minecraft ${play.minecraftVersion} / ${play.loader} ${play.loaderVersion}`,
    `echo Window ${play.width}x${play.height}  RAM ${play.ramMinMb}-${play.ramMaxMb} MB`,
    "echo.",
    "echo This folder is a play instance. The game is not launched from here.",
    "echo Craft does not sign in to Microsoft and does not store an account.",
    "echo Mods are in the mods folder. Java is under runtime.",
    "exit /b 0",
    "",
  ].join("\r\n");
}
