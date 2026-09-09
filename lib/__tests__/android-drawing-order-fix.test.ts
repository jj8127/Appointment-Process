import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  updateAndroidSettingsGradle,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("expo-build-properties/build/android.js") as {
  updateAndroidSettingsGradle: (options: {
    contents: string;
    buildFromSource: boolean;
  }) => string;
};
const withAndroidDrawingOrderFix =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../../plugins/with-android-drawing-order-fix.js") as (
    config: Record<string, unknown>,
  ) => Record<string, unknown>;

type SettingsGradleMod = (config: {
  [key: string]: unknown;
  modRequest: Record<string, never>;
  modResults: { contents: string; language: string };
}) => Promise<{ modResults: { contents: string } }>;

const {
  CONFIG_PLUGIN_ID,
  GRADLE_PATCH_BLOCK,
  GRADLE_PATCH_MARKER,
  GRADLE_UPSTREAM_BLOCK,
  PATCH_ANCHOR,
  PATCH_BLOCK,
  PATCH_MARKER,
  SETTINGS_PATCH_BLOCK,
  assertBuildConsumesPatchedSource,
  patchAndroidSettingsGradle,
  patchReactAndroidGradle,
  patchReactSwipeRefreshLayout,
  validateBuildWiring,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("../../scripts/patches/apply-android-drawing-order-fix.cjs") as {
  CONFIG_PLUGIN_ID: string;
  PATCH_ANCHOR: string;
  PATCH_BLOCK: string;
  PATCH_MARKER: string;
  GRADLE_PATCH_BLOCK: string;
  GRADLE_PATCH_MARKER: string;
  GRADLE_UPSTREAM_BLOCK: string;
  SETTINGS_PATCH_BLOCK: string;
  assertBuildConsumesPatchedSource: (
    repoRoot: string,
    options?: { requireGeneratedSettings?: boolean },
  ) => void;
  patchAndroidSettingsGradle: (source: string) => {
    changed: boolean;
    source: string;
  };
  patchReactAndroidGradle: (source: string) => {
    changed: boolean;
    source: string;
  };
  patchReactSwipeRefreshLayout: (source: string) => {
    changed: boolean;
    source: string;
  };
  validateBuildWiring: (appConfig: unknown, settingsSource: string) => void;
};

const supportedSource = `public class ReactSwipeRefreshLayout {
${PATCH_ANCHOR}
    // Existing React Native implementation.
  }
}
`;
const supportedGradleSource = `dependencies {
${GRADLE_UPSTREAM_BLOCK}
}
`;
const generatedSettingsSource = `includeBuild(expoAutolinking.reactNative) {
  dependencySubstitution {
    substitute(module("com.facebook.react:react-android")).using(project(":packages:react-native:ReactAndroid"))
    substitute(module("com.facebook.react:react-native")).using(project(":packages:react-native:ReactAndroid"))
    substitute(module("com.facebook.react:hermes-android")).using(project(":packages:react-native:ReactAndroid:hermes-engine"))
    substitute(module("com.facebook.react:hermes-engine")).using(project(":packages:react-native:ReactAndroid:hermes-engine"))
  }
}
`;

describe("Android drawing-order native patch", () => {
  test("guards only an invalid AndroidX child index", () => {
    const result = patchReactSwipeRefreshLayout(supportedSource);

    expect(result.changed).toBe(true);
    expect(result.source).toContain(PATCH_BLOCK);
    expect(result.source).toContain(
      "return if (childIndex in 0 until childCount) childIndex else drawingPosition",
    );
    expect(result.source.indexOf(PATCH_MARKER)).toBeLessThan(
      result.source.indexOf(PATCH_ANCHOR),
    );
  });

  test("is idempotent", () => {
    const once = patchReactSwipeRefreshLayout(supportedSource);
    const twice = patchReactSwipeRefreshLayout(once.source);

    expect(twice).toEqual({ changed: false, source: once.source });
  });

  test("fails closed when the pinned native source shape changes", () => {
    expect(() => patchReactSwipeRefreshLayout("unexpected source")).toThrow(
      "does not match the supported React Native layout",
    );
  });

  test("fails closed when an existing patch body is ambiguous", () => {
    expect(() =>
      patchReactSwipeRefreshLayout(`// ${PATCH_MARKER}\n${supportedSource}`),
    ).toThrow("exists but its body does not match");
  });

  test("keeps Hermes on the pinned Maven AAR during the RN source build", () => {
    const once = patchReactAndroidGradle(supportedGradleSource);
    const twice = patchReactAndroidGradle(once.source);

    expect(once.changed).toBe(true);
    expect(once.source).toContain(GRADLE_PATCH_BLOCK);
    expect(once.source).not.toContain(GRADLE_UPSTREAM_BLOCK);
    expect(twice).toEqual({ changed: false, source: once.source });
    expect(() => patchReactAndroidGradle(`// ${GRADLE_PATCH_MARKER}`)).toThrow(
      "body does not match",
    );
  });

  test("rewrites generated settings once and keeps React Native source-built", () => {
    const once = patchAndroidSettingsGradle(generatedSettingsSource);
    const twice = patchAndroidSettingsGradle(once.source);

    expect(once.changed).toBe(true);
    expect(once.source).toContain(SETTINGS_PATCH_BLOCK);
    expect(once.source).toContain("com.facebook.react:react-android");
    expect(once.source).toContain("com.facebook.react:react-native");
    expect(once.source).not.toContain("com.facebook.react:hermes-android");
    expect(once.source).not.toContain("com.facebook.react:hermes-engine");
    expect(twice).toEqual({ changed: false, source: once.source });
  });

  test("accepts the pinned Expo build-properties generated source block", () => {
    const expoGeneratedSettings = updateAndroidSettingsGradle({
      contents: 'rootProject.name = "fixture"\n',
      buildFromSource: true,
    });
    const result = patchAndroidSettingsGradle(expoGeneratedSettings);

    expect(result.changed).toBe(true);
    expect(result.source).toContain(SETTINGS_PATCH_BLOCK);
    expect(result.source).toContain("com.facebook.react:react-android");
    expect(result.source).not.toContain("com.facebook.react:hermes-android");
  });

  test("applies the registered Expo settings mod after build-properties", async () => {
    const expoGeneratedSettings = updateAndroidSettingsGradle({
      contents: 'rootProject.name = "fixture"\n',
      buildFromSource: true,
    });
    const configured = withAndroidDrawingOrderFix({
      name: "fixture",
      slug: "fixture",
    }) as {
      [key: string]: unknown;
      mods: { android: { settingsGradle: SettingsGradleMod } };
    };
    const result = await configured.mods.android.settingsGradle({
      ...configured,
      modRequest: {},
      modResults: {
        contents: expoGeneratedSettings,
        language: "groovy",
      },
    });

    expect(result.modResults.contents).toContain(SETTINGS_PATCH_BLOCK);
    expect(result.modResults.contents).toContain(
      "com.facebook.react:react-android",
    );
    expect(result.modResults.contents).not.toContain(
      "com.facebook.react:hermes-android",
    );
  });

  test("fails closed when generated source-build settings drift", () => {
    expect(() => patchAndroidSettingsGradle("unexpected settings")).toThrow(
      "does not contain exactly one supported React Native source-build entry",
    );
    expect(() =>
      patchAndroidSettingsGradle(
        generatedSettingsSource.replace(
          'substitute(module("com.facebook.react:hermes-engine")).using(project(":packages:react-native:ReactAndroid:hermes-engine"))',
          "",
        ),
      ),
    ).toThrow(
      "does not contain exactly one supported Hermes source substitution",
    );
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

  test("requires ordered Expo plugin and generated Gradle source-build wiring", () => {
    const patchedSettingsSource = patchAndroidSettingsGradle(
      generatedSettingsSource,
    ).source;
    const appConfig = {
      expo: {
        plugins: [
          [
            "expo-build-properties",
            { android: { buildReactNativeFromSource: true } },
          ],
          CONFIG_PLUGIN_ID,
        ],
      },
    };

    expect(() =>
      validateBuildWiring(appConfig, patchedSettingsSource),
    ).not.toThrow();
    expect(() =>
      validateBuildWiring({ expo: { plugins: [] } }, patchedSettingsSource),
    ).toThrow("buildReactNativeFromSource=true");
    expect(() =>
      validateBuildWiring(
        {
          expo: {
            plugins: [
              CONFIG_PLUGIN_ID,
              [
                "expo-build-properties",
                { android: { buildReactNativeFromSource: true } },
              ],
            ],
          },
        },
        patchedSettingsSource,
      ),
    ).toThrow("after expo-build-properties");
    expect(() => validateBuildWiring(appConfig, "")).toThrow(
      "does not consume and verify the patched React Native source",
    );
    expect(() =>
      validateBuildWiring(
        appConfig,
        `${patchedSettingsSource}\nsubstitute(module("com.facebook.react:hermes-android"))`,
      ),
    ).toThrow("must keep pinned Hermes on the Maven AAR");
  });

  test("lets prepare repair dependencies before stale generated settings block Gradle", () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "garamin-drawing-order-wiring-"),
    );
    try {
      mkdirSync(join(fixtureRoot, "plugins"));
      mkdirSync(join(fixtureRoot, "android"));
      writeFileSync(
        join(fixtureRoot, "app.json"),
        JSON.stringify({
          expo: {
            plugins: [
              [
                "expo-build-properties",
                { android: { buildReactNativeFromSource: true } },
              ],
              CONFIG_PLUGIN_ID,
            ],
          },
        }),
      );
      writeFileSync(
        join(fixtureRoot, "plugins", "with-android-drawing-order-fix.js"),
        "withSettingsGradle(config, patchAndroidSettingsGradle);",
      );
      writeFileSync(
        join(fixtureRoot, "android", "settings.gradle"),
        "stale generated settings",
      );

      expect(() => assertBuildConsumesPatchedSource(fixtureRoot)).not.toThrow();
      expect(() =>
        assertBuildConsumesPatchedSource(fixtureRoot, {
          requireGeneratedSettings: true,
        }),
      ).toThrow("does not consume and verify the patched React Native source");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("runs from prepare before the no-Git early exit", () => {
    const prepareSource = readFileSync(
      join(process.cwd(), "scripts", "prepare.js"),
      "utf8",
    );

    expect(
      prepareSource.indexOf("applyAndroidDrawingOrderFix();"),
    ).toBeGreaterThan(-1);
    expect(
      prepareSource.indexOf("applyAndroidDrawingOrderFix();"),
    ).toBeLessThan(prepareSource.indexOf("if (!inGitRepository())"));
  });
});
