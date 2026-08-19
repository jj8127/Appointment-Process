#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const EXPECTED_CMAKE_VERSION = "3.30.5";
const CMAKE_PACKAGE = `cmake;${EXPECTED_CMAKE_VERSION}`;

function fail(message) {
  throw new Error(`[eas-android-cmake] ${message}`);
}

function comparablePath(value, platform = process.platform) {
  const resolved = path.resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function resolveAndroidSdkRoot(env, platform = process.platform) {
  const roots = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT].filter(Boolean);
  if (roots.length === 0) {
    fail("ANDROID_HOME or ANDROID_SDK_ROOT is required.");
  }
  if (
    roots.length > 1 &&
    comparablePath(roots[0], platform) !== comparablePath(roots[1], platform)
  ) {
    fail("ANDROID_HOME and ANDROID_SDK_ROOT point to different SDK roots.");
  }
  return path.resolve(roots[0]);
}

function cmakeBinaryPath(sdkRoot, platform = process.platform) {
  return path.join(
    sdkRoot,
    "cmake",
    EXPECTED_CMAKE_VERSION,
    "bin",
    platform === "win32" ? "cmake.exe" : "cmake",
  );
}

function resolveSdkManagerPath(
  sdkRoot,
  { platform = process.platform, exists = fs.existsSync } = {},
) {
  const executable = platform === "win32" ? "sdkmanager.bat" : "sdkmanager";
  const candidates = [
    path.join(sdkRoot, "cmdline-tools", "latest", "bin", executable),
    path.join(sdkRoot, "cmdline-tools", "tools", "bin", executable),
    path.join(sdkRoot, "tools", "bin", executable),
  ];
  const resolved = candidates.find((candidate) => exists(candidate));
  if (!resolved) {
    fail("Unable to locate sdkmanager under the configured Android SDK root.");
  }
  return resolved;
}

function verifyCmakeBinary(
  cmakePath,
  { env = process.env, spawn = spawnSync, platform = process.platform } = {},
) {
  const result = spawn(cmakePath, ["--version"], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: platform === "win32",
  });
  if (result.error) {
    fail(`Unable to start CMake: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`CMake version check exited with status ${String(result.status)}.`);
  }
  const match = String(result.stdout ?? "").match(
    /^cmake version (\d+\.\d+\.\d+)/m,
  );
  if (match?.[1] !== EXPECTED_CMAKE_VERSION) {
    fail(
      `Expected CMake ${EXPECTED_CMAKE_VERSION}, found ${match?.[1] || "an unreadable version"}.`,
    );
  }
}

function ensureAndroidCmake({
  env = process.env,
  platform = process.platform,
  exists = fs.existsSync,
  spawn = spawnSync,
  check = false,
  log = console.log,
} = {}) {
  if (!check && env.EAS_BUILD_PLATFORM !== "android") {
    log(
      `[eas-android-cmake] Skipped outside an Android EAS build (${env.EAS_BUILD_PLATFORM || "local"}).`,
    );
    return { skipped: true, changed: false };
  }

  if (
    env.CMAKE_VERSION &&
    env.CMAKE_VERSION !== EXPECTED_CMAKE_VERSION
  ) {
    fail(
      `CMAKE_VERSION must be ${EXPECTED_CMAKE_VERSION}, found ${env.CMAKE_VERSION}.`,
    );
  }

  const sdkRoot = resolveAndroidSdkRoot(env, platform);
  const cmakePath = cmakeBinaryPath(sdkRoot, platform);
  if (exists(cmakePath)) {
    verifyCmakeBinary(cmakePath, { env, spawn, platform });
    log(`[eas-android-cmake] Verified CMake ${EXPECTED_CMAKE_VERSION}.`);
    return { skipped: false, changed: false, cmakePath };
  }
  if (check) {
    fail(`CMake ${EXPECTED_CMAKE_VERSION} is not installed in the Android SDK.`);
  }

  const sdkManagerPath = resolveSdkManagerPath(sdkRoot, { platform, exists });
  const result = spawn(sdkManagerPath, ["--install", CMAKE_PACKAGE], {
    env,
    stdio: "inherit",
    shell: false,
    windowsHide: platform === "win32",
  });
  if (result.error) {
    fail(`Unable to start sdkmanager: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`sdkmanager exited with status ${String(result.status)}.`);
  }
  if (!exists(cmakePath)) {
    fail(`sdkmanager completed without installing CMake ${EXPECTED_CMAKE_VERSION}.`);
  }
  verifyCmakeBinary(cmakePath, { env, spawn, platform });

  log(`[eas-android-cmake] Installed CMake ${EXPECTED_CMAKE_VERSION}.`);
  return { skipped: false, changed: true, cmakePath };
}

if (require.main === module) {
  try {
    ensureAndroidCmake({ check: process.argv.includes("--check") });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  CMAKE_PACKAGE,
  EXPECTED_CMAKE_VERSION,
  cmakeBinaryPath,
  ensureAndroidCmake,
  resolveAndroidSdkRoot,
  resolveSdkManagerPath,
  verifyCmakeBinary,
};
