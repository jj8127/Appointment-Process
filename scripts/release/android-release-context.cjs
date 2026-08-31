#!/usr/bin/env node
/* global __dirname */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  verifyAndroidDrawingOrderInstrumentation,
  validateAppConfig,
} = require("../patches/android-drawing-order-instrumentation.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXPECTED_BRANCH =
  "release/garamin-4.2.8-link-fix-20260831";
const EXPECTED_APP_VERSION = "4.2.8";
const EXPECTED_EAS_PROJECT_ID = "6e9a1f11-8b60-46f9-8af2-168188dbf3db";
const EXPECTED_LINK_FIX_TEST_URL =
  "https://us06web.zoom.us/j/00000000000?pwd=test-token";
const EXPECTED_TRACKED_INSTRUMENTATION_PATHS = [
  "gradle-plugins/react-android-drawing-order-guard/.gitignore",
  "gradle-plugins/react-android-drawing-order-guard/build.gradle.kts",
  "gradle-plugins/react-android-drawing-order-guard/drawing-order-guard.pro",
  "gradle-plugins/react-android-drawing-order-guard/settings.gradle.kts",
  "gradle-plugins/react-android-drawing-order-guard/src/main/java/com/garamin/build/ReactAndroidDrawingOrderGuardPlugin.java",
];

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
  const trackedInstrumentationPaths = runGit(repoRoot, [
    "ls-files",
    "--",
    "gradle-plugins/react-android-drawing-order-guard",
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
    trackedInstrumentationPaths,
    ignoredAndroidSettings,
    easIgnoreExists: fs.existsSync(path.join(repoRoot, ".easignore")),
    androidSettingsExists: fs.existsSync(
      path.join(repoRoot, "android", "settings.gradle"),
    ),
    androidAppBuildExists: fs.existsSync(
      path.join(repoRoot, "android", "app", "build.gradle"),
    ),
    legacyCmakeInstallerExists: fs.existsSync(
      path.join(repoRoot, "scripts", "eas", "install-android-cmake.cjs"),
    ),
    appConfig,
    easConfig,
    packageJson,
    externalUrlSource: fs.readFileSync(
      path.join(repoRoot, "lib", "open-external-url.ts"),
      "utf8",
    ),
    externalUrlTestSource: fs.readFileSync(
      path.join(repoRoot, "lib", "__tests__", "external-url.test.ts"),
      "utf8",
    ),
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
  const trackedInstrumentationPaths = context.trackedInstrumentationPaths
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
  const expectedInstrumentationPaths = [
    ...EXPECTED_TRACKED_INSTRUMENTATION_PATHS,
  ].sort();
  if (
    trackedInstrumentationPaths.length !== expectedInstrumentationPaths.length ||
    trackedInstrumentationPaths.some(
      (entry, index) => entry !== expectedInstrumentationPaths[index],
    )
  ) {
    fail(
      "Tracked drawing-order Gradle plugin files do not match the exact EAS archive contract.",
    );
  }
  if (
    !context.androidSettingsExists ||
    !context.androidAppBuildExists ||
    !context.ignoredAndroidSettings
  ) {
    fail(
      "Generated Android Gradle wiring is missing or is not excluded from the EAS archive.",
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
    fail("package.json no longer validates the instrumentation contract from prepare.");
  }
  if (
    context.legacyCmakeInstallerExists ||
    context.packageJson?.scripts?.["eas-build-post-install"] !== undefined ||
    context.easConfig?.build?.production?.env?.CMAKE_VERSION !== undefined
  ) {
    fail(
      "Legacy ReactAndroid source-build CMake bootstrap must remain removed.",
    );
  }
  if (context.externalUrlSource.includes("Linking.canOpenURL(")) {
    fail("Messenger link opening must not use the Android capability preflight.");
  }
  for (const requiredSnippet of [
    "await Linking.openURL(normalized);",
    "if (!isHttpUrl(normalized)) throw error;",
    "await WebBrowser.openBrowserAsync(normalized);",
  ]) {
    if (!context.externalUrlSource.includes(requiredSnippet)) {
      fail("Messenger link opening is missing the direct-open or HTTP fallback contract.");
    }
  }
  if (
    !context.externalUrlTestSource.includes(EXPECTED_LINK_FIX_TEST_URL) ||
    !context.externalUrlTestSource.includes(
      "expect(mockedCanOpenURL).not.toHaveBeenCalled();",
    )
  ) {
    fail("Messenger link regression coverage is missing or drifted.");
  }

  validateAppConfig(context.appConfig);
  return context;
}

function verifyAndroidReleaseContext({
  repoRoot = REPO_ROOT,
  collectContext = collectReleaseContext,
  verifyInstrumentation = verifyAndroidDrawingOrderInstrumentation,
} = {}) {
  const context = validateReleaseContext(collectContext(repoRoot));
  verifyInstrumentation({ repoRoot, requireGeneratedAndroid: true });
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
  EXPECTED_EAS_PROJECT_ID,
  EXPECTED_LINK_FIX_TEST_URL,
  EXPECTED_TRACKED_INSTRUMENTATION_PATHS,
  REPO_ROOT,
  collectReleaseContext,
  runReleaseCommand,
  validateEasArgs,
  validateReleaseContext,
  verifyAndroidReleaseContext,
};
