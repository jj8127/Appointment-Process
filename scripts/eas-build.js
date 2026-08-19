#!/usr/bin/env node
/* global __dirname */

const path = require("node:path");
const fs = require("node:fs");
const { execSync, spawnSync } = require("node:child_process");
const {
  validateEasArgs,
  verifyAndroidReleaseContext,
} = require("./release/android-release-context.cjs");

const MIN_EAS_CLI_VERSION = "18.3.0";
const REPO_ROOT = path.resolve(__dirname, "..");

function getLocalHooksPath(repoRoot = REPO_ROOT) {
  try {
    return execSync("git config --local --get core.hooksPath", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function unsetLocalHooksPath(repoRoot = REPO_ROOT) {
  try {
    execSync("git config --local --unset core.hooksPath", {
      cwd: repoRoot,
      stdio: "ignore",
    });
  } catch {
    // no-op
  }
}

function usageError() {
  return new Error(
    "Usage: node ./scripts/eas-build.js <android|ios> [profile] [additional eas args...]",
  );
}

function resolveNpxCliPath({
  nodePath = process.execPath,
  npmExecPath = process.env.npm_execpath,
  exists = fs.existsSync,
} = {}) {
  const candidates = [];
  if (npmExecPath) {
    candidates.push(path.join(path.dirname(npmExecPath), "npx-cli.js"));
  }
  candidates.push(
    path.join(
      path.dirname(nodePath),
      "node_modules",
      "npm",
      "bin",
      "npx-cli.js",
    ),
  );

  const resolved = candidates.find((candidate) => exists(candidate));
  if (!resolved) {
    throw new Error(
      "[eas-build] Unable to locate npm's npx-cli.js for a shell-free EAS invocation.",
    );
  }
  return resolved;
}

function resolveEasInvocation(options = {}) {
  const nodePath = options.nodePath ?? process.execPath;
  return {
    command: nodePath,
    args: [
      resolveNpxCliPath({ ...options, nodePath }),
      "--yes",
      `eas-cli@${MIN_EAS_CLI_VERSION}`,
    ],
    reason: `[eas-build] Using pinned eas-cli ${MIN_EAS_CLI_VERSION} through npm's shell-free Node entrypoint.`,
  };
}

function parseBuildRequest(argv) {
  const [platform, profileOrArg, ...rest] = argv;
  if (platform !== "android" && platform !== "ios") {
    throw usageError();
  }

  const profile =
    profileOrArg && !profileOrArg.startsWith("-")
      ? profileOrArg
      : "production";
  const extraArgs =
    profileOrArg && profileOrArg.startsWith("-")
      ? [profileOrArg, ...rest]
      : rest;
  return { platform, profile, extraArgs };
}

function runEas(
  buildArgs,
  { repoRoot = REPO_ROOT, spawn = spawnSync } = {},
) {
  const invocation = resolveEasInvocation();

  if (invocation.reason) {
    console.log(invocation.reason);
  }

  return spawn(invocation.command, [...invocation.args, ...buildArgs], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
    shell: false,
    windowsHide: false,
  });
}

function runBuild(
  argv,
  {
    repoRoot = REPO_ROOT,
    verify = verifyAndroidReleaseContext,
    getHooksPath = getLocalHooksPath,
    unsetHooksPath = unsetLocalHooksPath,
    runEasCommand = runEas,
  } = {},
) {
  const { platform, profile, extraArgs } = parseBuildRequest(argv);

  if (platform === "android" && profile === "production") {
    validateEasArgs(extraArgs);
    verify({ repoRoot });
  }

  const hooksPath = getHooksPath(repoRoot);
  if (hooksPath.startsWith(".husky")) {
    unsetHooksPath(repoRoot);
    console.log(
      `[eas-build] Removed local core.hooksPath (${hooksPath}) before EAS build.`,
    );
  }

  const result = runEasCommand(
    [
      "build",
      "--platform",
      platform,
      "--profile",
      profile,
      ...extraArgs,
    ],
    { repoRoot },
  );

  if (result.error) {
    throw result.error;
  }
  return typeof result.status === "number" ? result.status : 1;
}

if (require.main === module) {
  try {
    process.exitCode = runBuild(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  MIN_EAS_CLI_VERSION,
  REPO_ROOT,
  parseBuildRequest,
  resolveEasInvocation,
  resolveNpxCliPath,
  runBuild,
  runEas,
};
