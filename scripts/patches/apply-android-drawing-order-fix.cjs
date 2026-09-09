#!/usr/bin/env node
/* global __dirname */

const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_REACT_NATIVE_VERSION = "0.81.5";
const CONFIG_PLUGIN_ID = "./plugins/with-android-drawing-order-fix";
const CONFIG_PLUGIN_RELATIVE_PATH = path.join(
  "plugins",
  "with-android-drawing-order-fix.js",
);
const PATCH_MARKER = "GaramIn Android drawing-order guard";
const TARGET_RELATIVE_PATH = path.join(
  "ReactAndroid",
  "src",
  "main",
  "java",
  "com",
  "facebook",
  "react",
  "views",
  "swiperefresh",
  "ReactSwipeRefreshLayout.kt",
);
const GRADLE_TARGET_RELATIVE_PATH = path.join(
  "ReactAndroid",
  "build.gradle.kts",
);
const PATCH_ANCHOR =
  "  public override fun setRefreshing(refreshing: Boolean) {";
const GRADLE_PATCH_MARKER = "GaramIn prebuilt Hermes source-build guard";
const GRADLE_UPSTREAM_BLOCK =
  '  compileOnly(project(":packages:react-native:ReactAndroid:hermes-engine"))';
const GRADLE_PATCH_BLOCK = `  // ${GRADLE_PATCH_MARKER}.
  compileOnly("com.facebook.react:hermes-android:\$version")`;
const REACT_SOURCE_SUBSTITUTIONS = [
  'substitute(module("com.facebook.react:react-android")).using(project(":packages:react-native:ReactAndroid"))',
  'substitute(module("com.facebook.react:react-native")).using(project(":packages:react-native:ReactAndroid"))',
];
const HERMES_SOURCE_SUBSTITUTIONS = [
  'substitute(module("com.facebook.react:hermes-android")).using(project(":packages:react-native:ReactAndroid:hermes-engine"))',
  'substitute(module("com.facebook.react:hermes-engine")).using(project(":packages:react-native:ReactAndroid:hermes-engine"))',
];
const SETTINGS_PATCH_MARKER = "GaramIn Android drawing-order source preflight";
const SETTINGS_PATCH_BLOCK = `// ${SETTINGS_PATCH_MARKER}.
def drawingOrderPatchScript = new File(
  rootDir,
  "../scripts/patches/apply-android-drawing-order-fix.cjs"
)
providers.exec {
  workingDir(rootDir.parentFile)
  commandLine("node", drawingOrderPatchScript.absolutePath, "--check")
}.result.get().assertNormalExitValue()`;
const REQUIRED_SETTINGS_SNIPPETS = [
  "includeBuild(expoAutolinking.reactNative)",
  ...REACT_SOURCE_SUBSTITUTIONS,
  "apply-android-drawing-order-fix.cjs",
  'commandLine("node", drawingOrderPatchScript.absolutePath, "--check")',
];
const FORBIDDEN_SETTINGS_SNIPPETS = [
  'substitute(module("com.facebook.react:hermes-android"))',
  'substitute(module("com.facebook.react:hermes-engine"))',
];
const PATCH_BLOCK = `  /**
   * ${PATCH_MARKER}.
   *
   * react-native-screens can temporarily change SwipeRefreshLayout's child hierarchy while an
   * outgoing native-stack screen is being drawn. AndroidX may then return its cached refresh
   * indicator index after that index has become invalid. Keep AndroidX's ordering when valid and
   * fall back to the framework-requested position only for the stale-index frame.
   */
  public override fun getChildDrawingOrder(childCount: Int, drawingPosition: Int): Int {
    val childIndex = super.getChildDrawingOrder(childCount, drawingPosition)
    return if (childIndex in 0 until childCount) childIndex else drawingPosition
  }

`;

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function patchReactSwipeRefreshLayout(source) {
  if (source.includes(PATCH_MARKER)) {
    if (
      countOccurrences(source, PATCH_MARKER) !== 1 ||
      countOccurrences(source, PATCH_BLOCK) !== 1 ||
      countOccurrences(source, PATCH_ANCHOR) !== 1 ||
      source.indexOf(PATCH_BLOCK) > source.indexOf(PATCH_ANCHOR)
    ) {
      throw new Error(
        `[android-drawing-order-fix] ${PATCH_MARKER} exists but its body does not match the expected patch.`,
      );
    }
    return { changed: false, source };
  }

  if (countOccurrences(source, PATCH_ANCHOR) !== 1) {
    throw new Error(
      "[android-drawing-order-fix] ReactSwipeRefreshLayout source does not match the supported React Native layout.",
    );
  }

  return {
    changed: true,
    source: source.replace(PATCH_ANCHOR, `${PATCH_BLOCK}${PATCH_ANCHOR}`),
  };
}

function patchReactAndroidGradle(source) {
  if (source.includes(GRADLE_PATCH_MARKER)) {
    if (
      countOccurrences(source, GRADLE_PATCH_MARKER) !== 1 ||
      countOccurrences(source, GRADLE_PATCH_BLOCK) !== 1 ||
      source.includes(GRADLE_UPSTREAM_BLOCK)
    ) {
      throw new Error(
        `[android-drawing-order-fix] ${GRADLE_PATCH_MARKER} exists but its body does not match the expected patch.`,
      );
    }
    return { changed: false, source };
  }

  if (countOccurrences(source, GRADLE_UPSTREAM_BLOCK) !== 1) {
    throw new Error(
      "[android-drawing-order-fix] ReactAndroid Gradle source does not match the supported React Native layout.",
    );
  }

  return {
    changed: true,
    source: source.replace(GRADLE_UPSTREAM_BLOCK, GRADLE_PATCH_BLOCK),
  };
}

function patchAndroidSettingsGradle(source) {
  const normalizedSource = source.replace(/\r\n/g, "\n");
  const requiredSourceSnippets = [
    "includeBuild(expoAutolinking.reactNative)",
    ...REACT_SOURCE_SUBSTITUTIONS,
  ];

  for (const snippet of requiredSourceSnippets) {
    if (countOccurrences(normalizedSource, snippet) !== 1) {
      throw new Error(
        `[android-drawing-order-fix] Generated settings.gradle does not contain exactly one supported React Native source-build entry: ${snippet}`,
      );
    }
  }

  if (normalizedSource.includes(SETTINGS_PATCH_MARKER)) {
    if (
      countOccurrences(normalizedSource, SETTINGS_PATCH_MARKER) !== 1 ||
      countOccurrences(normalizedSource, SETTINGS_PATCH_BLOCK) !== 1 ||
      HERMES_SOURCE_SUBSTITUTIONS.some((snippet) =>
        normalizedSource.includes(snippet),
      )
    ) {
      throw new Error(
        `[android-drawing-order-fix] ${SETTINGS_PATCH_MARKER} exists but its body or dependency substitutions do not match the expected patch.`,
      );
    }
    return { changed: false, source };
  }

  for (const snippet of HERMES_SOURCE_SUBSTITUTIONS) {
    if (countOccurrences(normalizedSource, snippet) !== 1) {
      throw new Error(
        `[android-drawing-order-fix] Generated settings.gradle does not contain exactly one supported Hermes source substitution: ${snippet}`,
      );
    }
  }

  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const retainedLines = source
    .split(/\r?\n/)
    .filter((line) => !HERMES_SOURCE_SUBSTITUTIONS.includes(line.trim()));
  while (retainedLines.at(-1) === "") {
    retainedLines.pop();
  }

  return {
    changed: true,
    source: `${retainedLines.join(eol)}${eol}${eol}${SETTINGS_PATCH_BLOCK.replaceAll("\n", eol)}${eol}`,
  };
}

function validateAppConfig(appConfig) {
  const plugins = appConfig?.expo?.plugins ?? [];
  const buildPropertiesPluginIndex = plugins.findIndex(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties",
  );
  const buildPropertiesPlugin = plugins[buildPropertiesPluginIndex];
  const buildsReactNativeFromSource =
    buildPropertiesPlugin?.[1]?.android?.buildReactNativeFromSource === true;

  if (!buildsReactNativeFromSource) {
    throw new Error(
      "[android-drawing-order-fix] app.json must set expo-build-properties android.buildReactNativeFromSource=true.",
    );
  }

  const configPluginIndex = plugins.findIndex(
    (plugin) =>
      plugin === CONFIG_PLUGIN_ID ||
      (Array.isArray(plugin) && plugin[0] === CONFIG_PLUGIN_ID),
  );
  if (
    configPluginIndex < 0 ||
    configPluginIndex <= buildPropertiesPluginIndex
  ) {
    throw new Error(
      `[android-drawing-order-fix] app.json must register ${CONFIG_PLUGIN_ID} after expo-build-properties.`,
    );
  }
}

function validateGeneratedSettings(settingsSource) {
  const normalizedSource = settingsSource.replace(/\r\n/g, "\n");

  const missingSnippet = REQUIRED_SETTINGS_SNIPPETS.find(
    (snippet) => countOccurrences(normalizedSource, snippet) !== 1,
  );
  if (missingSnippet) {
    throw new Error(
      `[android-drawing-order-fix] android/settings.gradle does not consume and verify the patched React Native source: ${missingSnippet}`,
    );
  }

  const forbiddenSnippet = FORBIDDEN_SETTINGS_SNIPPETS.find((snippet) =>
    normalizedSource.includes(snippet),
  );
  if (forbiddenSnippet) {
    throw new Error(
      `[android-drawing-order-fix] android/settings.gradle must keep pinned Hermes on the Maven AAR: ${forbiddenSnippet}`,
    );
  }

  if (countOccurrences(normalizedSource, SETTINGS_PATCH_BLOCK) !== 1) {
    throw new Error(
      `[android-drawing-order-fix] Generated settings.gradle does not contain the exact ${SETTINGS_PATCH_MARKER} block.`,
    );
  }
}

function validateBuildWiring(appConfig, settingsSource) {
  validateAppConfig(appConfig);
  if (settingsSource !== undefined) {
    validateGeneratedSettings(settingsSource);
  }
}

function assertBuildConsumesPatchedSource(
  repoRoot,
  { requireGeneratedSettings = false } = {},
) {
  const appConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "app.json"), "utf8"),
  );
  validateAppConfig(appConfig);

  const configPluginSource = fs.readFileSync(
    path.join(repoRoot, CONFIG_PLUGIN_RELATIVE_PATH),
    "utf8",
  );
  for (const snippet of ["withSettingsGradle", "patchAndroidSettingsGradle"]) {
    if (countOccurrences(configPluginSource, snippet) < 1) {
      throw new Error(
        `[android-drawing-order-fix] Expo config plugin is missing required wiring: ${snippet}`,
      );
    }
  }

  const settingsPath = path.join(repoRoot, "android", "settings.gradle");
  if (requireGeneratedSettings) {
    if (!fs.existsSync(settingsPath)) {
      throw new Error(
        "[android-drawing-order-fix] Generated android/settings.gradle is missing. Run Expo prebuild before the Android build.",
      );
    }
    validateGeneratedSettings(fs.readFileSync(settingsPath, "utf8"));
  }
}

function resolveReactNativePackage(repoRoot) {
  const packageJsonPath = require.resolve("react-native/package.json", {
    paths: [repoRoot],
  });
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  if (packageJson.version !== EXPECTED_REACT_NATIVE_VERSION) {
    throw new Error(
      `[android-drawing-order-fix] Expected react-native ${EXPECTED_REACT_NATIVE_VERSION}, found ${packageJson.version}. Review the native patch before installing.`,
    );
  }

  return path.dirname(packageJsonPath);
}

function applyAndroidDrawingOrderFix({
  repoRoot = path.resolve(__dirname, "..", ".."),
  check = false,
} = {}) {
  assertBuildConsumesPatchedSource(repoRoot, {
    requireGeneratedSettings: check,
  });
  const reactNativeRoot = resolveReactNativePackage(repoRoot);
  const targetPath = path.join(reactNativeRoot, TARGET_RELATIVE_PATH);
  const gradleTargetPath = path.join(
    reactNativeRoot,
    GRADLE_TARGET_RELATIVE_PATH,
  );
  const originalSource = fs.readFileSync(targetPath, "utf8");
  const originalGradleSource = fs.readFileSync(gradleTargetPath, "utf8");
  const result = patchReactSwipeRefreshLayout(originalSource);
  const gradleResult = patchReactAndroidGradle(originalGradleSource);

  if (check && (result.changed || gradleResult.changed)) {
    throw new Error(
      "[android-drawing-order-fix] Native source patches are not fully applied. Run this script without --check.",
    );
  }

  if (result.changed) {
    fs.writeFileSync(targetPath, result.source, "utf8");
    console.log(`[android-drawing-order-fix] Applied to ${targetPath}`);
  } else {
    console.log(`[android-drawing-order-fix] Verified ${targetPath}`);
  }

  if (gradleResult.changed) {
    fs.writeFileSync(gradleTargetPath, gradleResult.source, "utf8");
    console.log(`[android-drawing-order-fix] Applied to ${gradleTargetPath}`);
  } else {
    console.log(`[android-drawing-order-fix] Verified ${gradleTargetPath}`);
  }

  return {
    changed: result.changed || gradleResult.changed,
    targetPaths: [targetPath, gradleTargetPath],
  };
}

if (require.main === module) {
  applyAndroidDrawingOrderFix({ check: process.argv.includes("--check") });
}

module.exports = {
  EXPECTED_REACT_NATIVE_VERSION,
  CONFIG_PLUGIN_ID,
  FORBIDDEN_SETTINGS_SNIPPETS,
  GRADLE_PATCH_BLOCK,
  GRADLE_PATCH_MARKER,
  GRADLE_UPSTREAM_BLOCK,
  PATCH_ANCHOR,
  PATCH_BLOCK,
  PATCH_MARKER,
  REACT_SOURCE_SUBSTITUTIONS,
  REQUIRED_SETTINGS_SNIPPETS,
  HERMES_SOURCE_SUBSTITUTIONS,
  SETTINGS_PATCH_BLOCK,
  SETTINGS_PATCH_MARKER,
  applyAndroidDrawingOrderFix,
  assertBuildConsumesPatchedSource,
  patchAndroidSettingsGradle,
  patchReactAndroidGradle,
  patchReactSwipeRefreshLayout,
  validateAppConfig,
  validateBuildWiring,
  validateGeneratedSettings,
};
