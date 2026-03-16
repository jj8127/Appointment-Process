#!/usr/bin/env node

const { execSync, spawnSync } = require("node:child_process");

const MIN_EAS_CLI_VERSION = "18.3.0";

function run(command) {
  return execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getLocalHooksPath() {
  try {
    return run("git config --local --get core.hooksPath");
  } catch {
    return "";
  }
}

function unsetLocalHooksPath() {
  try {
    execSync("git config --local --unset core.hooksPath", { stdio: "ignore" });
  } catch {
    // no-op
  }
}

function printUsageAndExit() {
  console.error(
    "Usage: node ./scripts/eas-build.js <android|ios> [profile] [additional eas args...]",
  );
  process.exit(1);
}

function parseSemver(version) {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return match.slice(1).map((segment) => Number(segment));
}

function compareSemver(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  if (!leftParts || !rightParts) {
    return 0;
  }

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }

  return 0;
}

function getGlobalEasVersion() {
  const useShell = process.platform === "win32";
  const result = spawnSync("eas", ["--version"], {
    encoding: "utf8",
    env: process.env,
    shell: useShell,
  });

  if (result.error && result.error.code === "ENOENT") {
    return null;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    return null;
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  const match = output.match(/eas-cli\/(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

function resolveEasInvocation() {
  const globalVersion = getGlobalEasVersion();

  if (globalVersion && compareSemver(globalVersion, MIN_EAS_CLI_VERSION) >= 0) {
    return {
      command: "eas",
      args: [],
      reason: null,
    };
  }

  const reason = globalVersion
    ? `[eas-build] Global eas-cli ${globalVersion} is older than required ${MIN_EAS_CLI_VERSION}; using npx eas-cli@${MIN_EAS_CLI_VERSION}.`
    : `[eas-build] Global eas-cli was not found; using npx eas-cli@${MIN_EAS_CLI_VERSION}.`;

  return {
    command: "npx",
    args: ["--yes", `eas-cli@${MIN_EAS_CLI_VERSION}`],
    reason,
  };
}

const [platform, profileOrArg, ...rest] = process.argv.slice(2);
if (!platform) {
  printUsageAndExit();
}

if (platform !== "android" && platform !== "ios") {
  printUsageAndExit();
}

const profile = profileOrArg && !profileOrArg.startsWith("-")
  ? profileOrArg
  : "production";
const extraArgs = profileOrArg && profileOrArg.startsWith("-")
  ? [profileOrArg, ...rest]
  : rest;

const hooksPath = getLocalHooksPath();
if (hooksPath.startsWith(".husky")) {
  unsetLocalHooksPath();
  console.log(
    `[eas-build] Removed local core.hooksPath (${hooksPath}) before EAS build.`,
  );
}

const args = [
  "build",
  "--platform",
  platform,
  "--profile",
  profile,
  ...extraArgs,
];

function runEas(buildArgs) {
  const useShell = process.platform === "win32";
  const invocation = resolveEasInvocation();

  if (invocation.reason) {
    console.log(invocation.reason);
  }

  return spawnSync(invocation.command, [...invocation.args, ...buildArgs], {
    stdio: "inherit",
    env: process.env,
    shell: useShell,
  });
}

const result = runEas(args);

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
