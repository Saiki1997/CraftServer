export type Finding = {
  id: string;
  title: string;
  detail: string;
  suggestion: string;
  action?: "java" | "ram" | "port" | "eula";
  javaMajor?: number;
};

const RULES: Array<{
  id: string;
  test: RegExp;
  title: string;
  detail: string;
  suggestion: string;
  action?: Finding["action"];
}> = [
  {
    id: "java-class",
    test: /UnsupportedClassVersionError|class file version|more recent version of the Java Runtime|unsupported class file major version/i,
    title: "Wrong Java version",
    detail: "The server jar was built for a newer Java runtime than the one that launched it.",
    suggestion: "Point this server at the Java major shown on its overview. Do not replace your system Java.",
    action: "java",
  },
  {
    id: "java-8-forge",
    test: /java\.lang\.ClassNotFoundException: java\.lang\.invoke\.MethodHandle|Unsupported major\.minor version/i,
    title: "Java runtime is incompatible",
    detail: "The crash matches a runtime that is newer or older than the mod loader expects.",
    suggestion: "Use the Java major assigned to this server. Forge 1.12.2 and older must stay on Java 8.",
    action: "java",
  },
  {
    id: "oom",
    test: /OutOfMemoryError|Java heap space|GC overhead limit exceeded/i,
    title: "Server ran out of memory",
    detail: "The JVM heap was exhausted.",
    suggestion: "Raise the maximum RAM only if the machine has it free. Close other heavy packs first.",
    action: "ram",
  },
  {
    id: "eula",
    test: /You need to agree to the EULA|eula\.txt/i,
    title: "EULA not accepted",
    detail: "Vanilla refuses to run until eula=true.",
    suggestion: "Accept the Minecraft EULA in server settings. That writes eula.txt in the export.",
    action: "eula",
  },
  {
    id: "port",
    test: /Failed to bind to port|Address already in use|Port \d+ is already/i,
    title: "Port is already in use",
    detail: "Another process is listening on the configured port.",
    suggestion: "Choose a different server port. This app will not change your firewall or router.",
    action: "port",
  },
  {
    id: "missing-dep",
    test: /ModResolutionException|Missing or unsupported mandatory dependencies|Unmet dependency|requires .+ version|Failed to resolve dependency/i,
    title: "Missing or incompatible mod",
    detail: "A mod declared a dependency the server does not have, or the version range does not match.",
    suggestion: "Read the mod name in the log. Add that project from the mod manager, or disable the mod that requires it. Nothing is changed automatically.",
  },
  {
    id: "client-mod",
    test: /client-?side only|Invalid dist|environment:\s*CLIENT|Mod .+ only (works|runs) on the client|Attempted to load class .+ for invalid side/i,
    title: "Client-only mod on the server",
    detail: "A mod that does not support a dedicated server was loaded.",
    suggestion: "Disable that mod in the mod list. Do not delete it from the original pack archive.",
  },
  {
    id: "mixin",
    test: /MixinApplyError|Mixin prepare failed|CRITICAL: Mixin/i,
    title: "Mixin conflict",
    detail: "Two mods patched the same game code, or a mod does not match this Minecraft version.",
    suggestion: "Note the mixin package in the log. Update or disable that mod. Do not apply random JVM flags to hide this.",
  },
  {
    id: "duplicate",
    test: /DuplicateModsFoundException|Found duplicate mods|Mod .+ is already loaded/i,
    title: "Duplicate mod",
    detail: "The same mod id is present twice.",
    suggestion: "Disable one of the copies in the mod list. Keep the copy that matches the pack version.",
  },
  {
    id: "jar",
    test: /Unable to access jarfile|Could not find or load main class/i,
    title: "Launch jar missing",
    detail: "The start command ran before the loader installer finished, or the jar name does not match.",
    suggestion: "Re-run the exported install script. Forge and NeoForge create run.bat only after the installer succeeds.",
  },
  {
    id: "network",
    test: /Failed to download|Connection refused|UnknownHostException|SSLHandshakeException/i,
    title: "A download or connection failed",
    detail: "The log shows a network failure while fetching a library or talking to Mojang.",
    suggestion: "Retry the failed download. Check the URL is still on a trusted host. Do not restart the whole install if earlier stages already verified.",
  },
];

export function diagnoseLog(text: string, javaMajor?: number): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    if (!rule.test.test(text) || seen.has(rule.id)) continue;
    seen.add(rule.id);
    const finding: Finding = {
      id: rule.id,
      title: rule.title,
      detail: rule.detail,
      suggestion: rule.suggestion,
      action: rule.action,
    };
    if (rule.id === "java-class") {
      const major = text.match(/class file version (\d+)/i);
      if (major) {
        const classFile = Number(major[1]);
        const java = classFile - 44;
        if (java >= 8 && java <= 30) {
          finding.javaMajor = java;
          finding.suggestion = `The class file version maps to Java ${java}. Assign that runtime before launching again.`;
        }
      } else if (javaMajor) {
        finding.javaMajor = javaMajor;
      }
    }
    findings.push(finding);
  }
  if (findings.length === 0 && text.trim().length > 40) {
    findings.push({
      id: "unmatched",
      title: "No known pattern",
      detail: "The log does not match the built-in checks.",
      suggestion: "Search the first caused-by line and the mod id near it. Unknown mods are left installed.",
    });
  }
  return findings;
}
