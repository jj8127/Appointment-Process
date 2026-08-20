#!/usr/bin/env node
/* global __dirname */

const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_REACT_NATIVE_VERSION = "0.81.5";
const EXPECTED_AGP_VERSION = "8.11.0";
const CONFIG_PLUGIN_ID = "./plugins/with-android-drawing-order-fix";
const CONFIG_PLUGIN_RELATIVE_PATH = path.join(
  "plugins",
  "with-android-drawing-order-fix.js",
);
const INSTRUMENTATION_PLUGIN_ID =
  "com.garamin.react-android-drawing-order-guard";
const INSTRUMENTATION_PLUGIN_RELATIVE_PATH = path.join(
  "gradle-plugins",
  "react-android-drawing-order-guard",
);
const GRADLE_JVMARGS_KEY = "org.gradle.jvmargs";
const GRADLE_JVMARGS_UPSTREAM_VALUE =
  "-Xmx2048m -XX:MaxMetaspaceSize=512m";
const GRADLE_JVMARGS_REQUIRED_VALUE =
  "-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8";
const SETTINGS_PLUGIN_MARKER =
  "GaramIn prebuilt ReactAndroid drawing-order instrumentation";
const SETTINGS_PLUGIN_BLOCK = `  // ${SETTINGS_PLUGIN_MARKER}.
  includeBuild(new File(settingsDir, "../gradle-plugins/react-android-drawing-order-guard"))`;
const APP_PLUGIN_MARKER =
  "GaramIn prebuilt ReactAndroid drawing-order instrumentation";
const APP_PLUGIN_BLOCK = `plugins {
    // ${APP_PLUGIN_MARKER}.
    id("${INSTRUMENTATION_PLUGIN_ID}")
}`;
const LEGACY_REACT_SOURCE_BUILD_BLOCK = `includeBuild(expoAutolinking.reactNative) {
  dependencySubstitution {
    substitute(module("com.facebook.react:react-android")).using(project(":packages:react-native:ReactAndroid"))
    substitute(module("com.facebook.react:react-native")).using(project(":packages:react-native:ReactAndroid"))
  }
}`;
const LEGACY_SOURCE_PREFLIGHT_MARKER =
  "GaramIn Android drawing-order source preflight";
const LEGACY_SOURCE_PREFLIGHT_BLOCK = `// ${LEGACY_SOURCE_PREFLIGHT_MARKER}.
def drawingOrderPatchScript = new File(
  rootDir,
  "../scripts/patches/apply-android-drawing-order-fix.cjs"
)
providers.exec {
  workingDir(rootDir.parentFile)
  commandLine("node", drawingOrderPatchScript.absolutePath, "--check")
}.result.get().assertNormalExitValue()`;
const FORBIDDEN_SOURCE_BUILD_PATTERN =
  /includeBuild\s*\(\s*expoAutolinking\.reactNative\s*\)|project\(\s*["']:packages:react-native:ReactAndroid|GaramIn Android drawing-order source preflight|drawingOrderPatchScript|apply-android-drawing-order-fix\.cjs/;
const REQUIRED_PLUGIN_FILES = [
  "settings.gradle.kts",
  "build.gradle.kts",
  path.join(
    "src",
    "main",
    "java",
    "com",
    "garamin",
    "build",
    "ReactAndroidDrawingOrderGuardPlugin.java",
  ),
  "drawing-order-guard.pro",
];

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function preserveEol(source, normalizedSource) {
  return source.includes("\r\n")
    ? normalizedSource.replaceAll("\n", "\r\n")
    : normalizedSource;
}

function patchAndroidGradleProperties(properties) {
  if (!Array.isArray(properties)) {
    throw new Error(
      "[android-drawing-order-instrumentation] Generated gradle.properties has an unsupported parsed structure.",
    );
  }

  const matchingPropertyIndexes = [];
  properties.forEach((property, index) => {
    if (
      property?.type === "property" &&
      property.key === GRADLE_JVMARGS_KEY
    ) {
      matchingPropertyIndexes.push(index);
    }
  });

  if (matchingPropertyIndexes.length !== 1) {
    throw new Error(
      `[android-drawing-order-instrumentation] Generated gradle.properties must contain exactly one ${GRADLE_JVMARGS_KEY} property; found ${matchingPropertyIndexes.length}.`,
    );
  }

  const propertyIndex = matchingPropertyIndexes[0];
  const property = properties[propertyIndex];
  if (property.value === GRADLE_JVMARGS_REQUIRED_VALUE) {
    return { changed: false, properties };
  }

  if (property.value !== GRADLE_JVMARGS_UPSTREAM_VALUE) {
    throw new Error(
      `[android-drawing-order-instrumentation] Generated gradle.properties contains an unsupported ${GRADLE_JVMARGS_KEY} value: ${property.value}`,
    );
  }

  return {
    changed: true,
    properties: properties.map((item, index) =>
      index === propertyIndex
        ? { ...item, value: GRADLE_JVMARGS_REQUIRED_VALUE }
        : item,
    ),
  };
}

function stripLegacySourceBuildWiring(normalizedSource) {
  const legacyBlockCount = countOccurrences(
    normalizedSource,
    LEGACY_REACT_SOURCE_BUILD_BLOCK,
  );
  const legacyPreflightCount = countOccurrences(
    normalizedSource,
    LEGACY_SOURCE_PREFLIGHT_BLOCK,
  );
  const hasLegacyFragment = FORBIDDEN_SOURCE_BUILD_PATTERN.test(normalizedSource);

  if (!hasLegacyFragment) {
    return normalizedSource;
  }

  if (legacyBlockCount !== 1 || legacyPreflightCount !== 1) {
    throw new Error(
      "[android-drawing-order-instrumentation] Generated settings.gradle contains an unsupported or partial legacy React Native source-build block.",
    );
  }

  const retainedSource = normalizedSource
    .replace(LEGACY_REACT_SOURCE_BUILD_BLOCK, "")
    .replace(LEGACY_SOURCE_PREFLIGHT_BLOCK, "")
    .replace(/\n{3,}/g, "\n\n");

  if (FORBIDDEN_SOURCE_BUILD_PATTERN.test(retainedSource)) {
    throw new Error(
      "[android-drawing-order-instrumentation] Generated settings.gradle still contains React Native source-build wiring after legacy migration.",
    );
  }
  return retainedSource;
}

function patchAndroidSettingsGradle(source) {
  const normalizedInput = source.replace(/\r\n/g, "\n");
  let normalizedSource = stripLegacySourceBuildWiring(normalizedInput);
  const markerCount = countOccurrences(
    normalizedSource,
    SETTINGS_PLUGIN_MARKER,
  );
  const blockCount = countOccurrences(normalizedSource, SETTINGS_PLUGIN_BLOCK);
  const pathCount = countOccurrences(
    normalizedSource,
    "../gradle-plugins/react-android-drawing-order-guard",
  );

  if (markerCount === 1 && blockCount === 1 && pathCount === 1) {
    validateGeneratedSettings(normalizedSource);
    return {
      changed: normalizedSource !== normalizedInput,
      source: preserveEol(source, normalizedSource),
    };
  }

  if (markerCount !== 0 || blockCount !== 0 || pathCount !== 0) {
    throw new Error(
      `[android-drawing-order-instrumentation] ${SETTINGS_PLUGIN_MARKER} exists but its body is missing, duplicated, or modified.`,
    );
  }

  const pluginManagementAnchor = "pluginManagement {";
  if (countOccurrences(normalizedSource, pluginManagementAnchor) !== 1) {
    throw new Error(
      "[android-drawing-order-instrumentation] Generated settings.gradle does not contain exactly one supported pluginManagement block.",
    );
  }

  normalizedSource = normalizedSource.replace(
    pluginManagementAnchor,
    `${pluginManagementAnchor}\n${SETTINGS_PLUGIN_BLOCK}`,
  );
  validateGeneratedSettings(normalizedSource);
  return {
    changed: true,
    source: preserveEol(source, normalizedSource),
  };
}

function patchAndroidAppBuildGradle(source) {
  const normalizedSource = source.replace(/\r\n/g, "\n");
  const markerCount = countOccurrences(normalizedSource, APP_PLUGIN_MARKER);
  const blockCount = countOccurrences(normalizedSource, APP_PLUGIN_BLOCK);
  const pluginIdCount = countOccurrences(
    normalizedSource,
    INSTRUMENTATION_PLUGIN_ID,
  );

  if (markerCount === 1 && blockCount === 1 && pluginIdCount === 1) {
    validateGeneratedAppBuildGradle(normalizedSource);
    return { changed: false, source };
  }

  if (markerCount !== 0 || blockCount !== 0 || pluginIdCount !== 0) {
    throw new Error(
      `[android-drawing-order-instrumentation] ${APP_PLUGIN_MARKER} exists but its app plugin block is missing, duplicated, or modified.`,
    );
  }

  const patchedSource = `${APP_PLUGIN_BLOCK}\n\n${normalizedSource}`;
  validateGeneratedAppBuildGradle(patchedSource);
  return {
    changed: true,
    source: preserveEol(source, patchedSource),
  };
}

function validateAppConfig(appConfig) {
  const plugins = appConfig?.expo?.plugins ?? [];
  const configPluginIndexes = plugins
    .map((plugin, index) =>
      plugin === CONFIG_PLUGIN_ID ||
      (Array.isArray(plugin) && plugin[0] === CONFIG_PLUGIN_ID)
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
  const buildPropertiesPluginIndexes = plugins
    .map((plugin, index) =>
      Array.isArray(plugin) && plugin[0] === "expo-build-properties"
        ? index
        : -1,
    )
    .filter((index) => index >= 0);

  if (configPluginIndexes.length !== 1) {
    throw new Error(
      `[android-drawing-order-instrumentation] app.json must register ${CONFIG_PLUGIN_ID} exactly once.`,
    );
  }
  if (buildPropertiesPluginIndexes.length !== 1) {
    throw new Error(
      "[android-drawing-order-instrumentation] app.json must register expo-build-properties exactly once.",
    );
  }

  const configPluginIndex = configPluginIndexes[0];
  const buildPropertiesPluginIndex = buildPropertiesPluginIndexes[0];
  const buildPropertiesPlugin = plugins[buildPropertiesPluginIndex];
  if (
    buildPropertiesPlugin?.[1]?.android?.buildReactNativeFromSource !== false
  ) {
    throw new Error(
      "[android-drawing-order-instrumentation] app.json must set expo-build-properties android.buildReactNativeFromSource=false so the official prebuilt ReactAndroid AAR is used.",
    );
  }
  if (configPluginIndex >= buildPropertiesPluginIndex) {
    throw new Error(
      `[android-drawing-order-instrumentation] app.json must register ${CONFIG_PLUGIN_ID} before expo-build-properties so its Gradle-properties mod runs after build-properties.`,
    );
  }
}

function validateGeneratedSettings(settingsSource) {
  const normalizedSource = settingsSource.replace(/\r\n/g, "\n");
  if (FORBIDDEN_SOURCE_BUILD_PATTERN.test(normalizedSource)) {
    throw new Error(
      "[android-drawing-order-instrumentation] Generated settings.gradle must not build ReactAndroid from source.",
    );
  }
  if (
    countOccurrences(normalizedSource, SETTINGS_PLUGIN_MARKER) !== 1 ||
    countOccurrences(normalizedSource, SETTINGS_PLUGIN_BLOCK) !== 1 ||
    countOccurrences(
      normalizedSource,
      "../gradle-plugins/react-android-drawing-order-guard",
    ) !== 1
  ) {
    throw new Error(
      "[android-drawing-order-instrumentation] Generated settings.gradle does not include the tracked instrumentation plugin exactly once.",
    );
  }
  if (
    normalizedSource.indexOf(SETTINGS_PLUGIN_BLOCK) <
      normalizedSource.indexOf("pluginManagement {") ||
    normalizedSource.indexOf(SETTINGS_PLUGIN_BLOCK) >
      normalizedSource.indexOf("\n}", normalizedSource.indexOf("pluginManagement {") + 1)
  ) {
    throw new Error(
      "[android-drawing-order-instrumentation] The tracked instrumentation plugin must be included inside pluginManagement.",
    );
  }
}

function validateGeneratedAppBuildGradle(appBuildSource) {
  const normalizedSource = appBuildSource.replace(/\r\n/g, "\n");
  if (
    countOccurrences(normalizedSource, APP_PLUGIN_MARKER) !== 1 ||
    countOccurrences(normalizedSource, APP_PLUGIN_BLOCK) !== 1 ||
    countOccurrences(normalizedSource, INSTRUMENTATION_PLUGIN_ID) !== 1 ||
    !normalizedSource.startsWith(`${APP_PLUGIN_BLOCK}\n`)
  ) {
    throw new Error(
      "[android-drawing-order-instrumentation] Generated android/app/build.gradle does not apply the tracked instrumentation plugin exactly once at the top of the script.",
    );
  }
}

function resolveReactNativePackage(repoRoot) {
  const packageJsonPath = require.resolve("react-native/package.json", {
    paths: [repoRoot],
  });
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (packageJson.version !== EXPECTED_REACT_NATIVE_VERSION) {
    throw new Error(
      `[android-drawing-order-instrumentation] Expected react-native ${EXPECTED_REACT_NATIVE_VERSION}, found ${packageJson.version}. Review the bytecode instrumentation before installing.`,
    );
  }
  return path.dirname(packageJsonPath);
}

function validateTrackedInstrumentationPlugin(repoRoot) {
  const pluginRoot = path.join(repoRoot, INSTRUMENTATION_PLUGIN_RELATIVE_PATH);
  for (const relativePath of REQUIRED_PLUGIN_FILES) {
    if (!fs.existsSync(path.join(pluginRoot, relativePath))) {
      throw new Error(
        `[android-drawing-order-instrumentation] Tracked Gradle plugin file is missing: ${path.join(INSTRUMENTATION_PLUGIN_RELATIVE_PATH, relativePath)}`,
      );
    }
  }

  const buildSource = fs.readFileSync(
    path.join(pluginRoot, "build.gradle.kts"),
    "utf8",
  );
  const implementationSource = fs.readFileSync(
    path.join(
      pluginRoot,
      "src",
      "main",
      "java",
      "com",
      "garamin",
      "build",
      "ReactAndroidDrawingOrderGuardPlugin.java",
    ),
    "utf8",
  );
  const requiredBuildSnippets = [
    `com.android.tools.build:gradle-api:${EXPECTED_AGP_VERSION}`,
    `id = "${INSTRUMENTATION_PLUGIN_ID}"`,
  ];
  const requiredImplementationSnippets = [
    "InstrumentationScope.ALL",
    "FramesComputationMode.COMPUTE_FRAMES_FOR_INSTRUMENTED_METHODS",
    "ScopedArtifact.CLASSES",
    '"com.facebook.react:react-android:0.81.5"',
    '"a4da05bc571946aa1034c0d7be46593719105fb9e81d58aded9183c85a1f04fc"',
    '"751dfdb935c8e66ab23dc15ac7e072a7d95fba6b7d8fb48d97ece3a2f171b0f5"',
    '"5780b154ece55333bf4c606fc9e0fda3f7e925aaa7297e89faf95ca92db9619b"',
    '"13e27eeff4a38a7977bf83a415a5d6600859f51c2886b55e41e10cb2c929974e"',
    '"56c8f1701ce4f85c92c88fdbc0216a2926db2c079945afdb68ffa995fbde02e4"',
    '"8689166a37eb4388245d810543a7d56d468f9ebd13dfba3db0197c4fc2730030"',
    '"com/facebook/react/views/swiperefresh/ReactSwipeRefreshLayout"',
    '"(II)I"',
    "Opcodes.INVOKESPECIAL",
    "Opcodes.IFLT",
    "Opcodes.IF_ICMPGE",
  ];
  for (const snippet of requiredBuildSnippets) {
    if (countOccurrences(buildSource, snippet) !== 1) {
      throw new Error(
        `[android-drawing-order-instrumentation] Tracked Gradle plugin build contract is missing or duplicated: ${snippet}`,
      );
    }
  }
  for (const snippet of requiredImplementationSnippets) {
    if (countOccurrences(implementationSource, snippet) < 1) {
      throw new Error(
        `[android-drawing-order-instrumentation] Tracked Gradle plugin implementation contract is missing: ${snippet}`,
      );
    }
  }
}

function assertBuildUsesPrebuiltInstrumentation(
  repoRoot,
  { requireGeneratedAndroid = false } = {},
) {
  const appConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "app.json"), "utf8"),
  );
  validateAppConfig(appConfig);
  validateTrackedInstrumentationPlugin(repoRoot);

  const reactNativeRoot = resolveReactNativePackage(repoRoot);
  const versionCatalogSource = fs.readFileSync(
    path.join(reactNativeRoot, "gradle", "libs.versions.toml"),
    "utf8",
  );
  if (
    countOccurrences(
      versionCatalogSource,
      `agp = "${EXPECTED_AGP_VERSION}"`,
    ) !== 1
  ) {
    throw new Error(
      `[android-drawing-order-instrumentation] React Native ${EXPECTED_REACT_NATIVE_VERSION} must pin AGP ${EXPECTED_AGP_VERSION}.`,
    );
  }

  const configPluginSource = fs.readFileSync(
    path.join(repoRoot, CONFIG_PLUGIN_RELATIVE_PATH),
    "utf8",
  );
  for (const snippet of [
    "withAppBuildGradle",
    "withGradleProperties",
    "withSettingsGradle",
    "patchAndroidAppBuildGradle",
    "patchAndroidGradleProperties",
    "patchAndroidSettingsGradle",
  ]) {
    if (countOccurrences(configPluginSource, snippet) < 1) {
      throw new Error(
        `[android-drawing-order-instrumentation] Expo config plugin is missing required wiring: ${snippet}`,
      );
    }
  }

  if (!requireGeneratedAndroid) {
    return;
  }

  const settingsPath = path.join(repoRoot, "android", "settings.gradle");
  const appBuildPath = path.join(
    repoRoot,
    "android",
    "app",
    "build.gradle",
  );
  const gradlePropertiesPath = path.join(
    repoRoot,
    "android",
    "gradle.properties",
  );
  for (const requiredPath of [
    settingsPath,
    appBuildPath,
    gradlePropertiesPath,
  ]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(
        `[android-drawing-order-instrumentation] Generated ${path.relative(repoRoot, requiredPath)} is missing. Run Expo prebuild before the Android build.`,
      );
    }
  }
  validateGeneratedSettings(fs.readFileSync(settingsPath, "utf8"));
  validateGeneratedAppBuildGradle(fs.readFileSync(appBuildPath, "utf8"));

  const { AndroidConfig } = require("expo/config-plugins");
  const gradlePropertiesResult = patchAndroidGradleProperties(
    AndroidConfig.Properties.parsePropertiesFile(
      fs.readFileSync(gradlePropertiesPath, "utf8"),
    ),
  );
  if (gradlePropertiesResult.changed) {
    throw new Error(
      `[android-drawing-order-instrumentation] android/gradle.properties must set ${GRADLE_JVMARGS_KEY}=${GRADLE_JVMARGS_REQUIRED_VALUE}. Run Expo prebuild before the Android build.`,
    );
  }
}

function verifyAndroidDrawingOrderInstrumentation({
  repoRoot = path.resolve(__dirname, "..", ".."),
  requireGeneratedAndroid = false,
} = {}) {
  assertBuildUsesPrebuiltInstrumentation(repoRoot, {
    requireGeneratedAndroid,
  });
  console.log(
    `[android-drawing-order-instrumentation] Verified prebuilt ReactAndroid instrumentation contract${requireGeneratedAndroid ? " and generated Android wiring" : ""}.`,
  );
  return { repoRoot };
}

if (require.main === module) {
  verifyAndroidDrawingOrderInstrumentation({
    requireGeneratedAndroid: process.argv.includes("--check"),
  });
}

module.exports = {
  APP_PLUGIN_BLOCK,
  APP_PLUGIN_MARKER,
  CONFIG_PLUGIN_ID,
  EXPECTED_AGP_VERSION,
  EXPECTED_REACT_NATIVE_VERSION,
  GRADLE_JVMARGS_KEY,
  GRADLE_JVMARGS_REQUIRED_VALUE,
  GRADLE_JVMARGS_UPSTREAM_VALUE,
  INSTRUMENTATION_PLUGIN_ID,
  LEGACY_REACT_SOURCE_BUILD_BLOCK,
  LEGACY_SOURCE_PREFLIGHT_BLOCK,
  SETTINGS_PLUGIN_BLOCK,
  SETTINGS_PLUGIN_MARKER,
  assertBuildUsesPrebuiltInstrumentation,
  patchAndroidAppBuildGradle,
  patchAndroidGradleProperties,
  patchAndroidSettingsGradle,
  validateAppConfig,
  validateGeneratedAppBuildGradle,
  validateGeneratedSettings,
  validateTrackedInstrumentationPlugin,
  verifyAndroidDrawingOrderInstrumentation,
};
