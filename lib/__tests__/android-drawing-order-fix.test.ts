import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const withBuildProperties =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("expo-build-properties").withBuildProperties as (
    config: Record<string, unknown>,
    props: { android: { buildReactNativeFromSource: boolean } },
  ) => Record<string, unknown>;
const withAndroidDrawingOrderFix =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../../plugins/with-android-drawing-order-fix.js") as (
    config: Record<string, unknown>,
  ) => Record<string, unknown>;

type GradleTextMod = (config: {
  [key: string]: unknown;
  modRequest: Record<string, never>;
  modResults: { contents: string; language: string };
}) => Promise<{ modResults: { contents: string } }>;

type GradleProperty =
  | { type: "comment"; value: string }
  | { type: "empty" }
  | { type: "property"; key: string; value: string };

type GradlePropertiesMod = (config: {
  [key: string]: unknown;
  modRequest: Record<string, never>;
  modResults: GradleProperty[];
}) => Promise<{ modResults: GradleProperty[] }>;

const {
  APP_PLUGIN_BLOCK,
  APP_PLUGIN_MARKER,
  CONFIG_PLUGIN_ID,
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("../../scripts/patches/android-drawing-order-instrumentation.cjs") as {
  APP_PLUGIN_BLOCK: string;
  APP_PLUGIN_MARKER: string;
  CONFIG_PLUGIN_ID: string;
  GRADLE_JVMARGS_KEY: string;
  GRADLE_JVMARGS_REQUIRED_VALUE: string;
  GRADLE_JVMARGS_UPSTREAM_VALUE: string;
  INSTRUMENTATION_PLUGIN_ID: string;
  LEGACY_REACT_SOURCE_BUILD_BLOCK: string;
  LEGACY_SOURCE_PREFLIGHT_BLOCK: string;
  SETTINGS_PLUGIN_BLOCK: string;
  SETTINGS_PLUGIN_MARKER: string;
  assertBuildUsesPrebuiltInstrumentation: (
    repoRoot: string,
    options?: { requireGeneratedAndroid?: boolean },
  ) => void;
  patchAndroidAppBuildGradle: (source: string) => {
    changed: boolean;
    source: string;
  };
  patchAndroidGradleProperties: (properties: GradleProperty[]) => {
    changed: boolean;
    properties: GradleProperty[];
  };
  patchAndroidSettingsGradle: (source: string) => {
    changed: boolean;
    source: string;
  };
  validateAppConfig: (appConfig: unknown) => void;
  validateGeneratedAppBuildGradle: (source: string) => void;
  validateGeneratedSettings: (source: string) => void;
  validateTrackedInstrumentationPlugin: (repoRoot: string) => void;
};

const generatedSettingsSource = `pluginManagement {
  def reactNativeGradlePlugin = "fixture"
}

plugins {
  id("com.facebook.react.settings")
}

rootProject.name = "fixture"
`;
const generatedAppBuildSource = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"
`;
const generatedGradleProperties: GradleProperty[] = [
  { type: "comment", value: "Project-wide Gradle settings." },
  {
    type: "property",
    key: GRADLE_JVMARGS_KEY,
    value: GRADLE_JVMARGS_UPSTREAM_VALUE,
  },
  { type: "property", key: "android.useAndroidX", value: "true" },
];

function validAppConfig() {
  return {
    expo: {
      plugins: [
        CONFIG_PLUGIN_ID,
        [
          "expo-build-properties",
          { android: { buildReactNativeFromSource: false } },
        ],
      ],
    },
  };
}

function copyTrackedPlugin(fixtureRoot: string) {
  const sourceRoot = join(
    process.cwd(),
    "gradle-plugins",
    "react-android-drawing-order-guard",
  );
  const destinationRoot = join(
    fixtureRoot,
    "gradle-plugins",
    "react-android-drawing-order-guard",
  );
  const relativePaths = [
    "settings.gradle.kts",
    "build.gradle.kts",
    "drawing-order-guard.pro",
    join(
      "src",
      "main",
      "java",
      "com",
      "garamin",
      "build",
      "ReactAndroidDrawingOrderGuardPlugin.java",
    ),
  ];

  for (const relativePath of relativePaths) {
    const destinationPath = join(destinationRoot, relativePath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    copyFileSync(join(sourceRoot, relativePath), destinationPath);
  }
  return destinationRoot;
}

describe("Android drawing-order prebuilt instrumentation", () => {
  test("pins one supported Gradle daemon property without mutating input", () => {
    const result = patchAndroidGradleProperties(generatedGradleProperties);

    expect(result.changed).toBe(true);
    expect(result.properties).not.toBe(generatedGradleProperties);
    expect(result.properties).toContainEqual({
      type: "property",
      key: GRADLE_JVMARGS_KEY,
      value: GRADLE_JVMARGS_REQUIRED_VALUE,
    });
    expect(generatedGradleProperties).toContainEqual({
      type: "property",
      key: GRADLE_JVMARGS_KEY,
      value: GRADLE_JVMARGS_UPSTREAM_VALUE,
    });
  });

  test("keeps the required Gradle daemon property idempotent", () => {
    const once = patchAndroidGradleProperties(generatedGradleProperties);
    const twice = patchAndroidGradleProperties(once.properties);

    expect(twice).toEqual({ changed: false, properties: once.properties });
  });

  test("fails closed on missing, duplicate, or drifted Gradle daemon properties", () => {
    const property = generatedGradleProperties[1];

    expect(() => patchAndroidGradleProperties([])).toThrow(
      `exactly one ${GRADLE_JVMARGS_KEY} property; found 0`,
    );
    expect(() => patchAndroidGradleProperties([property, property])).toThrow(
      `exactly one ${GRADLE_JVMARGS_KEY} property; found 2`,
    );
    expect(() =>
      patchAndroidGradleProperties([
        {
          type: "property",
          key: GRADLE_JVMARGS_KEY,
          value: "-Xmx3072m -XX:MaxMetaspaceSize=768m",
        },
      ]),
    ).toThrow(`unsupported ${GRADLE_JVMARGS_KEY} value`);
  });

  test("inserts the composite plugin inside pluginManagement exactly once", () => {
    const once = patchAndroidSettingsGradle(generatedSettingsSource);
    const twice = patchAndroidSettingsGradle(once.source);

    expect(once.changed).toBe(true);
    expect(once.source).toContain(SETTINGS_PLUGIN_BLOCK);
    expect(once.source.indexOf(SETTINGS_PLUGIN_BLOCK)).toBeGreaterThan(
      once.source.indexOf("pluginManagement {"),
    );
    expect(once.source.indexOf(SETTINGS_PLUGIN_BLOCK)).toBeLessThan(
      once.source.indexOf("\n}"),
    );
    expect(twice).toEqual({ changed: false, source: once.source });
    expect(() => validateGeneratedSettings(once.source)).not.toThrow();
  });

  test("preserves CRLF while keeping the settings patch idempotent", () => {
    const input = generatedSettingsSource.replaceAll("\n", "\r\n");
    const once = patchAndroidSettingsGradle(input);
    const twice = patchAndroidSettingsGradle(once.source);

    expect(twice).toEqual({ changed: false, source: once.source });
    expect(once.source).toContain("\r\n");
    expect(once.source.replaceAll("\r\n", "")).not.toContain("\n");
  });

  test("migrates only the exact legacy source-build and preflight pair", () => {
    const legacySource = `${generatedSettingsSource}\n${LEGACY_REACT_SOURCE_BUILD_BLOCK}\n\n${LEGACY_SOURCE_PREFLIGHT_BLOCK}\n`;
    const result = patchAndroidSettingsGradle(legacySource);

    expect(result.changed).toBe(true);
    expect(result.source).toContain(SETTINGS_PLUGIN_BLOCK);
    expect(result.source).not.toContain("expoAutolinking.reactNative)");
    expect(result.source).not.toContain("drawingOrderPatchScript");
    expect(patchAndroidSettingsGradle(result.source)).toEqual({
      changed: false,
      source: result.source,
    });
  });

  test("rejects partial, duplicated, or noncanonical legacy source wiring", () => {
    const partialLegacy = `${generatedSettingsSource}\n${LEGACY_REACT_SOURCE_BUILD_BLOCK}\n`;
    const duplicatedLegacy = `${generatedSettingsSource}\n${LEGACY_REACT_SOURCE_BUILD_BLOCK}\n${LEGACY_SOURCE_PREFLIGHT_BLOCK}\n${LEGACY_REACT_SOURCE_BUILD_BLOCK}\n`;
    const noncanonicalLegacy = `${generatedSettingsSource}\nincludeBuild ( expoAutolinking.reactNative ) {}`;

    for (const source of [partialLegacy, duplicatedLegacy, noncanonicalLegacy]) {
      expect(() => patchAndroidSettingsGradle(source)).toThrow(
        "unsupported or partial legacy React Native source-build block",
      );
    }
  });

  test("rejects a partial or duplicated settings instrumentation block", () => {
    const stableSource = patchAndroidSettingsGradle(
      generatedSettingsSource,
    ).source;

    expect(() =>
      patchAndroidSettingsGradle(
        stableSource.replace(SETTINGS_PLUGIN_BLOCK, `// ${SETTINGS_PLUGIN_MARKER}`),
      ),
    ).toThrow("body is missing, duplicated, or modified");
    expect(() =>
      patchAndroidSettingsGradle(`${stableSource}\n${SETTINGS_PLUGIN_BLOCK}`),
    ).toThrow("body is missing, duplicated, or modified");
  });

  test("applies the Android app plugin at the top exactly once", () => {
    const once = patchAndroidAppBuildGradle(generatedAppBuildSource);
    const twice = patchAndroidAppBuildGradle(once.source);

    expect(once.changed).toBe(true);
    expect(once.source.startsWith(`${APP_PLUGIN_BLOCK}\n`)).toBe(true);
    expect(once.source).toContain(INSTRUMENTATION_PLUGIN_ID);
    expect(twice).toEqual({ changed: false, source: once.source });
    expect(() => validateGeneratedAppBuildGradle(once.source)).not.toThrow();
  });

  test("rejects a partial or duplicated Android app plugin block", () => {
    const stableSource = patchAndroidAppBuildGradle(
      generatedAppBuildSource,
    ).source;

    expect(() =>
      patchAndroidAppBuildGradle(
        stableSource.replace(APP_PLUGIN_BLOCK, `// ${APP_PLUGIN_MARKER}`),
      ),
    ).toThrow("app plugin block is missing, duplicated, or modified");
    expect(() =>
      patchAndroidAppBuildGradle(`${stableSource}\n${APP_PLUGIN_BLOCK}`),
    ).toThrow("app plugin block is missing, duplicated, or modified");
  });

  test("requires the ordered config plugin and an explicit prebuilt ReactAndroid contract", () => {
    expect(() => validateAppConfig(validAppConfig())).not.toThrow();
    expect(() =>
      validateAppConfig({
        expo: {
          plugins: [
            CONFIG_PLUGIN_ID,
            ["expo-build-properties", { android: {} }],
          ],
        },
      }),
    ).toThrow("buildReactNativeFromSource=false");
    expect(() =>
      validateAppConfig({
        expo: {
          plugins: [
            CONFIG_PLUGIN_ID,
            [
              "expo-build-properties",
              { android: { buildReactNativeFromSource: true } },
            ],
          ],
        },
      }),
    ).toThrow("buildReactNativeFromSource=false");
    expect(() =>
      validateAppConfig({
        expo: {
          plugins: [
            [
              "expo-build-properties",
              { android: { buildReactNativeFromSource: false } },
            ],
            CONFIG_PLUGIN_ID,
          ],
        },
      }),
    ).toThrow("before expo-build-properties");
  });

  test("executes the real Expo settings, app, and properties mod stack repeatedly", async () => {
    const withDrawingOrderMod = withAndroidDrawingOrderFix({
      name: "fixture",
      slug: "fixture",
    });
    const configured = withBuildProperties(withDrawingOrderMod, {
      android: { buildReactNativeFromSource: false },
    }) as {
      [key: string]: unknown;
      mods: {
        android: {
          settingsGradle: GradleTextMod;
          appBuildGradle: GradleTextMod;
          gradleProperties: GradlePropertiesMod;
        };
      };
    };
    const settings = await configured.mods.android.settingsGradle({
      ...configured,
      modRequest: {},
      modResults: {
        contents: generatedSettingsSource,
        language: "groovy",
      },
    });
    const repeatedSettings = await configured.mods.android.settingsGradle({
      ...configured,
      modRequest: {},
      modResults: {
        contents: settings.modResults.contents,
        language: "groovy",
      },
    });
    const app = await configured.mods.android.appBuildGradle({
      ...configured,
      modRequest: {},
      modResults: {
        contents: generatedAppBuildSource,
        language: "groovy",
      },
    });
    const repeatedApp = await configured.mods.android.appBuildGradle({
      ...configured,
      modRequest: {},
      modResults: {
        contents: app.modResults.contents,
        language: "groovy",
      },
    });
    const properties = await configured.mods.android.gradleProperties({
      ...configured,
      modRequest: {},
      modResults: generatedGradleProperties,
    });
    const repeatedProperties = await configured.mods.android.gradleProperties({
      ...configured,
      modRequest: {},
      modResults: properties.modResults,
    });

    expect(settings.modResults.contents).toContain(SETTINGS_PLUGIN_BLOCK);
    expect(settings.modResults.contents).not.toContain(
      "expoAutolinking.reactNative)",
    );
    expect(repeatedSettings.modResults.contents).toBe(
      settings.modResults.contents,
    );
    expect(app.modResults.contents.startsWith(`${APP_PLUGIN_BLOCK}\n`)).toBe(
      true,
    );
    expect(repeatedApp.modResults.contents).toBe(app.modResults.contents);
    expect(properties.modResults).toContainEqual({
      type: "property",
      key: GRADLE_JVMARGS_KEY,
      value: GRADLE_JVMARGS_REQUIRED_VALUE,
    });
    expect(repeatedProperties.modResults).toEqual(properties.modResults);
  });

  test("validates the tracked fail-closed AGP instrumentation plugin", () => {
    expect(() =>
      validateTrackedInstrumentationPlugin(process.cwd()),
    ).not.toThrow();
    expect(() =>
      assertBuildUsesPrebuiltInstrumentation(process.cwd()),
    ).not.toThrow();
  });

  test("rejects missing or drifted tracked instrumentation sources", () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "garamin-instrumentation-plugin-"),
    );
    try {
      const pluginRoot = copyTrackedPlugin(fixtureRoot);
      const rulesPath = join(pluginRoot, "drawing-order-guard.pro");
      unlinkSync(rulesPath);
      expect(() => validateTrackedInstrumentationPlugin(fixtureRoot)).toThrow(
        "Tracked Gradle plugin file is missing",
      );

      copyFileSync(
        join(
          process.cwd(),
          "gradle-plugins",
          "react-android-drawing-order-guard",
          "drawing-order-guard.pro",
        ),
        rulesPath,
      );
      const implementationPath = join(
        pluginRoot,
        "src",
        "main",
        "java",
        "com",
        "garamin",
        "build",
        "ReactAndroidDrawingOrderGuardPlugin.java",
      );
      writeFileSync(
        implementationPath,
        readFileSync(implementationPath, "utf8").replace(
          "751dfdb935c8e66ab23dc15ac7e072a7d95fba6b7d8fb48d97ece3a2f171b0f5",
          "drifted",
        ),
      );
      expect(() => validateTrackedInstrumentationPlugin(fixtureRoot)).toThrow(
        "Tracked Gradle plugin implementation contract is missing",
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test.each([-1, 0, 1, 2, 3])(
    "keeps childCount=2 drawing order a permutation with cached index %i",
    (cachedCircleIndex) => {
      const childCount = 2;
      const drawingOrder = Array.from({ length: childCount }, (_, position) => {
        const androidXIndex =
          cachedCircleIndex < 0
            ? position
            : position === childCount - 1
              ? cachedCircleIndex
              : position >= cachedCircleIndex
                ? position + 1
                : position;
        return androidXIndex >= 0 && androidXIndex < childCount
          ? androidXIndex
          : position;
      });

      expect([...drawingOrder].sort()).toEqual([0, 1]);
      if (cachedCircleIndex >= childCount) {
        expect(drawingOrder).toEqual([0, 1]);
      }
    },
  );

  test("runs instrumentation validation from prepare before the no-Git exit", () => {
    const prepareSource = readFileSync(
      join(process.cwd(), "scripts", "prepare.js"),
      "utf8",
    );
    const verificationCall =
      "verifyAndroidDrawingOrderInstrumentation();";

    expect(prepareSource.indexOf(verificationCall)).toBeGreaterThan(-1);
    expect(prepareSource.indexOf(verificationCall)).toBeLessThan(
      prepareSource.indexOf("if (!inGitRepository())"),
    );
    expect(prepareSource).toContain(
      "./patches/android-drawing-order-instrumentation.cjs",
    );
    expect(prepareSource).not.toContain("applyAndroidDrawingOrderFix");
  });
});
