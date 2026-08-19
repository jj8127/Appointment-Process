#!/usr/bin/env node
/* global __dirname */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  applyAndroidDrawingOrderFix,
  validateAppConfig,
} = require("../patches/apply-android-drawing-order-fix.cjs");
const {
  EXPECTED_CMAKE_VERSION,
} = require("../eas/install-android-cmake.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXPECTED_BRANCH =
  "release/garamin-4.2.5-android-drawing-order-20260818";
const EXPECTED_APP_VERSION = "4.2.5";
const EXPECTED_EAS_PROJECT_ID = "6e9a1f11-8b60-46f9-8af2-168188dbf3db";
const EXPECTED_CMAKE_HOOK = "node ./scripts/eas/install-android-cmake.cjs";

function fail(message) {
  throw new Error(`[android-release-context] ${message}`);
}

function comparablePath(value) {
  const resolved = fs.realpathSync.native
    ? fs.realpathSync.native(value)
    : fs.realpathSync(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function runGit(repoRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error) {
    fail(`Unable to run git ${args[0]}.`);
  }
  if (!allowFailure && result.status !== 0) {
    fail(`git ${args[0]} failed.`);
  }
  return result;
}

function collectReleaseContext(repoRoot = REPO_ROOT) {
  const gitTopLevel = runGit(repoRoot, ["rev-parse", "--show-toplevel"])
    .stdout.trim();
  const branch = runGit(repoRoot, ["branch", "--show-current"]).stdout.trim();
  const head = runGit(repoRoot, ["rev-parse", "--short", "HEAD"])
    .stdout.trim();
  const status = runGit(repoRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]).stdout;
  const trackedAndroidPaths = runGit(repoRoot, [
    "ls-files",
    "--",
    "android",
  ]).stdout;
  const ignoredAndroidSettings =
    runGit(
      repoRoot,
      ["check-ignore", "-q", "--", "android/settings.gradle"],
      { allowFailure: true },
    ).status === 0;
  const appConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "app.json"), "utf8"),
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  const easConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "eas.json"), "utf8"),
  );

  return {
    repoRoot,
    gitTopLevel,
    branch,
    head,
    status,
    trackedAndroidPaths,
    ignoredAndroidSettings,
    easIgnoreExists: fs.existsSync(path.join(repoRoot, ".easignore")),
    androidSettingsExists: fs.existsSync(
      path.join(repoRoot, "android", "settings.gradle"),
    ),
    cmakeInstallerExists: fs.existsSync(
      path.join(repoRoot, "scripts", "eas", "install-android-cmake.cjs"),
    ),
    appConfig,
    easConfig,
    packageJson,
  };
}

function validateReleaseContext(context) {
  if (comparablePath(context.gitTopLevel) !== comparablePath(context.repoRoot)) {
    fail("Git top-level does not match the release script repository root.");
  }
  if (context.branch !== EXPECTED_BRANCH) {
    fail(
      `Expected branch ${EXPECTED_BRANCH}, found ${context.branch || "detached HEAD"}.`,
    );
  }
  if (context.status.length > 0) {
    fail("Release worktree is dirty; commit or remove unrelated changes first.");
  }
  if (context.trackedAndroidPaths.trim().length > 0) {
    fail("Generated android/ content must remain untracked for the EAS archive.");
  }
  if (!context.androidSettingsExists || !context.ignoredAndroidSettings) {
    fail(
      "Generated android/settings.gradle is missing or is not excluded from the EAS archive.",
    );
  }
  if (context.easIgnoreExists) {
    fail("A .easignore file requires explicit archive-scope review before release.");
  }
  if (context.appConfig?.expo?.version !== EXPECTED_APP_VERSION) {
    fail(
      `Expected app version ${EXPECTED_APP_VERSION}, found ${context.appConfig?.expo?.version ?? "missing"}.`,
    );
  }
  if (context.appConfig?.expo?.extra?.eas?.projectId !== EXPECTED_EAS_PROJECT_ID) {
    fail("EAS project ID does not match the GaramIn release project.");
  }
  if (
    typeof context.packageJson?.scripts?.prepare !== "string" ||
    !context.packageJson.scripts.prepare.includes("./scripts/prepare.js")
  ) {
    fail("package.json no longer runs the native patch from prepare.");
  }
  if (
    !context.cmakeInstallerExists ||
    context.packageJson?.scripts?.["eas-build-post-install"] !==
      EXPECTED_CMAKE_HOOK ||
    context.easConfig?.build?.production?.env?.CMAKE_VERSION !==
      EXPECTED_CMAKE_VERSION
  ) {
    fail(
      `EAS Android builds must install CMake ${EXPECTED_CMAKE_VERSION} through ${EXPECTED_CMAKE_HOOK}.`,
    );
  }

  validateAppConfig(context.appConfig);
  return context;
}

function verifyAndroidReleaseContext({
  repoRoot = REPO_ROOT,
  collectContext = collectReleaseContext,
  verifyNativePatch = applyAndroidDrawingOrderFix,
} = {}) {
  const context = validateReleaseContext(collectContext(repoRoot));
  verifyNativePatch({ repoRoot, check: true });
  return {
    repoRoot,
    branch: context.branch,
    head: context.head,
    version: context.appConfig.expo.version,
  };
}

function validateEasArgs(args) {
  const blockedFlags = ["--platform", "-p", "--profile", "-e"];
  const blockedArg = args.find((arg) =>
    blockedFlags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)),
  );
  if (blockedArg) {
    fail(`Release wrapper does not allow overriding ${blockedArg}.`);
  }
}

function runReleaseCommand(
  argv,
  {
    repoRoot = REPO_ROOT,
    verify = verifyAndroidReleaseContext,
    spawn = spawnSync,
  } = {},
) {
  const [mode, ...easArgs] = argv;
  if (mode !== "check" && mode !== "build") {
    fail("Usage: android-release-context.cjs <check|build> [EAS args].");
  }
  if (mode === "check" && easArgs.length > 0) {
    fail("The check mode does not accept EAS arguments.");
  }

  const verified = verify({ repoRoot });
  console.log(
    `[android-release-context] Verified ${verified.branch} at ${verified.head} (v${verified.version}).`,
  );

  if (mode === "check") {
    return 0;
  }

  validateEasArgs(easArgs);
  const result = spawn(
    process.execPath,
    [
      path.join(repoRoot, "scripts", "eas-build.js"),
      "android",
      "production",
      ...easArgs,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
      windowsHide: false,
    },
  );

  if (result.error) {
    fail("Unable to start the EAS build wrapper.");
  }
  return typeof result.status === "number" ? result.status : 1;
}

if (require.main === module) {
  try {
    process.exitCode = runReleaseCommand(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_APP_VERSION,
  EXPECTED_BRANCH,
  EXPECTED_CMAKE_HOOK,
  EXPECTED_EAS_PROJECT_ID,
  REPO_ROOT,
  collectReleaseContext,
  runReleaseCommand,
  validateEasArgs,
  validateReleaseContext,
  verifyAndroidReleaseContext,
};
