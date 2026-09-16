#!/usr/bin/env node
/* global __dirname */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { verifyBuildSource } = require("./release/verify-build-source.cjs");

const EAS_CLI_VERSION = "18.3.0";
const REPO_ROOT = path.resolve(__dirname, "..");

function fail(message) {
  throw new Error(`[eas-build] ${message}`);
}

function parseBuildRequest(argv) {
  if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    fail("Build arguments must be strings without null bytes.");
  }
  const [platform, profileOrArg, ...rest] = argv;
  if (platform !== "android" && platform !== "ios") {
    fail("Usage: node ./scripts/eas-build.js <android|ios> [profile] [--dry-run] [additional eas args...]");
  }
  const hasProfile = profileOrArg !== undefined && !profileOrArg.startsWith("-");
  const profile = hasProfile ? profileOrArg : "production";
  if (!profile || profile.trim() !== profile) {
    fail("The build profile must be a non-empty name without surrounding whitespace.");
  }
  const forwarded = hasProfile ? rest : [profileOrArg, ...rest].filter((arg) => arg !== undefined);
  for (const arg of forwarded) {
    if (arg === "--" || /^--(?:platform|profile)(?:=|$)/.test(arg) || /^-[pe](?:[^-]|$)/.test(arg)) {
      fail("Platform and profile must be selected using the wrapper's positional arguments, not additional EAS flags.");
    }
    if (arg.startsWith("--dry-run=")) {
      fail("--dry-run does not accept a value.");
    }
  }
  return {
    platform,
    profile,
    dryRun: forwarded.includes("--dry-run"),
    extraArgs: forwarded.filter((arg) => arg !== "--dry-run"),
  };
}

function readConfig(filePath, readFile = fs.readFileSync) {
  try {
    const value = JSON.parse(readFile(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("Configuration must be an object.");
    }
    return value;
  } catch {
    fail(`Unable to read a valid ${path.basename(filePath)} in the build source directory.`);
  }
}

function resolveNpxCliPath({
  nodePath = process.execPath,
  npmExecPath = process.env.npm_execpath,
  exists = fs.existsSync,
} = {}) {
  const candidates = [
    ...(npmExecPath ? [path.join(path.dirname(npmExecPath), "npx-cli.js")] : []),
    path.join(path.dirname(nodePath), "node_modules", "npm", "bin", "npx-cli.js"),
    path.resolve(path.dirname(nodePath), "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ];
  const resolved = candidates.find((candidate) => exists(candidate));
  if (!resolved) {
    fail("Unable to locate npm's npx-cli.js. Install Node.js with npm before building.");
  }
  return resolved;
}

function createBuildPlan(argv, {
  repoRoot = REPO_ROOT,
  readFile = fs.readFileSync,
  nodePath = process.execPath,
  npmExecPath = process.env.npm_execpath,
  exists = fs.existsSync,
} = {}) {
  const request = parseBuildRequest(argv);
  const root = path.resolve(repoRoot);
  // Read on every invocation: require(app.json) would retain a stale version in its module cache.
  const appConfig = readConfig(path.join(root, "app.json"), readFile);
  const version = appConfig.expo?.version;
  if (typeof version !== "string" || version.trim() !== version ||
      !/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(version)) {
    fail("app.json expo.version must contain a valid application version (for example, 4.2.12).");
  }
  const easConfig = readConfig(path.join(root, "eas.json"), readFile);
  if (!easConfig.build || !Object.prototype.hasOwnProperty.call(easConfig.build, request.profile) ||
      !easConfig.build[request.profile] || typeof easConfig.build[request.profile] !== "object" ||
      Array.isArray(easConfig.build[request.profile])) {
    fail(`The requested build profile '${request.profile}' is not configured in eas.json.`);
  }
  return {
    ...request,
    repoRoot: root,
    version,
    command: nodePath,
    args: [
      resolveNpxCliPath({ nodePath, npmExecPath, exists }),
      "--yes",
      `eas-cli@${EAS_CLI_VERSION}`,
      "build",
      "--platform", request.platform,
      "--profile", request.profile,
      ...request.extraArgs,
    ],
  };
}

function runBuild(argv, {
  spawn = spawnSync,
  logger = console,
  env = process.env,
  validatePlan = verifyBuildSource,
  ...planOptions
} = {}) {
  const plan = createBuildPlan(argv, planOptions);
  validatePlan(plan);
  logger.log(`[eas-build] Build source: ${plan.repoRoot}`);
  logger.log(`[eas-build] Platform: ${plan.platform} | Profile: ${plan.profile} | App version: ${plan.version}`);
  logger.log(`[eas-build] Using pinned eas-cli ${EAS_CLI_VERSION}.`);
  if (plan.dryRun) {
    logger.log("[eas-build] Dry run complete. No EAS command was launched and no files or Git hooks were changed.");
    return 0;
  }
  const result = spawn(plan.command, plan.args, {
    cwd: plan.repoRoot,
    stdio: "inherit",
    env,
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
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
  EAS_CLI_VERSION,
  REPO_ROOT,
  parseBuildRequest,
  resolveNpxCliPath,
  createBuildPlan,
  runBuild,
};
