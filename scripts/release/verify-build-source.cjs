#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  assertBuildUsesPrebuiltInstrumentation,
} = require("../patches/android-drawing-order-instrumentation.cjs");

const EAS_PROJECT_ID = "6e9a1f11-8b60-46f9-8af2-168188dbf3db";
const ANDROID_BUILD_INPUTS = [
  "plugins/with-android-drawing-order-fix.js",
  "scripts/patches/android-drawing-order-instrumentation.cjs",
  "scripts/prepare.js",
  "gradle-plugins/react-android-drawing-order-guard/.gitignore",
  "gradle-plugins/react-android-drawing-order-guard/settings.gradle.kts",
  "gradle-plugins/react-android-drawing-order-guard/build.gradle.kts",
  "gradle-plugins/react-android-drawing-order-guard/drawing-order-guard.pro",
  "gradle-plugins/react-android-drawing-order-guard/src/main/java/com/garamin/build/ReactAndroidDrawingOrderGuardPlugin.java",
];

function fail(message) {
  throw new Error(`[build-source] ${message}`);
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    fail(`Unable to verify local build inputs with git ${args[0]}.`);
  }
  return result.stdout;
}

function comparablePath(value) {
  const resolved = fs.realpathSync(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function verifyBuildSource(
  { repoRoot, platform, version },
  { git = runGit, verifyInstrumentation = assertBuildUsesPrebuiltInstrumentation } = {},
) {
  const gitRoot = git(repoRoot, ["rev-parse", "--show-toplevel"]).trim();
  if (comparablePath(gitRoot) !== comparablePath(repoRoot)) {
    fail("Build script and Git repository must use the same source folder.");
  }
  if (fs.existsSync(path.join(repoRoot, ".easignore"))) {
    fail("Review .easignore before building; this workflow verifies the .gitignore archive rules.");
  }
  const trackedNative = git(repoRoot, ["ls-files", "-z", "--", "android", "ios"]);
  if (trackedNative.length > 0) {
    fail("Generated android/ and ios/ must be excluded so EAS generates native versions from app.json.");
  }
  const archiveFiles = new Set(
    git(repoRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
      .split("\0")
      .filter(Boolean),
  );
  if ([...archiveFiles].some((file) => file.startsWith("android/") || file.startsWith("ios/"))) {
    fail("Generated android/ and ios/ must be ignored by the build archive.");
  }
  const requiredFiles = ["app.json", "package.json", "eas.json"];
  if (platform === "android") requiredFiles.push(...ANDROID_BUILD_INPUTS);
  for (const file of requiredFiles) {
    if (!archiveFiles.has(file) || !fs.existsSync(path.join(repoRoot, file))) {
      fail(`Required build input is missing or ignored: ${file}`);
    }
  }

  const appConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "app.json"), "utf8"));
  if (appConfig.expo?.version !== version) {
    fail("app.json changed after the build plan was prepared; run the command again.");
  }
  if (appConfig.expo?.extra?.eas?.projectId !== EAS_PROJECT_ID) {
    fail("app.json must point to the GaramIn EAS project.");
  }
  if (appConfig.expo?.runtimeVersion?.policy !== "appVersion") {
    fail("The appVersion runtime policy must follow app.json expo.version.");
  }

  if (platform === "android") {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const prepareSource = fs.readFileSync(path.join(repoRoot, "scripts/prepare.js"), "utf8");
    if (
      packageJson.scripts?.prepare !== "node ./scripts/prepare.js" ||
      !prepareSource.includes("verifyAndroidDrawingOrderInstrumentation();") ||
      packageJson.scripts?.["eas-build-post-install"] !== undefined
    ) {
      fail("Android install must validate the prebuilt drawing-order protection without the old source-build hook.");
    }
    verifyInstrumentation(repoRoot, { requireGeneratedAndroid: false });
  }
  return { repoRoot, platform, version };
}

module.exports = { ANDROID_BUILD_INPUTS, EAS_PROJECT_ID, verifyBuildSource };
