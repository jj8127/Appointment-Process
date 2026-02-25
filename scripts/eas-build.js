#!/usr/bin/env node

const { execSync, spawnSync } = require("node:child_process");

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
  const directResult = spawnSync("eas", buildArgs, {
    stdio: "inherit",
    env: process.env,
    shell: useShell,
  });

  if (directResult.error && directResult.error.code === "ENOENT") {
    return spawnSync("npx", ["eas", ...buildArgs], {
      stdio: "inherit",
      env: process.env,
      shell: useShell,
    });
  }

  return directResult;
}

const result = runEas(args);

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
