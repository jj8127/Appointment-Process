import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  EXPECTED_APP_VERSION,
  EXPECTED_BRANCH,
  EXPECTED_EAS_PROJECT_ID,
  EXPECTED_LINK_FIX_TEST_URL,
  EXPECTED_TRACKED_INSTRUMENTATION_PATHS,
  REPO_ROOT,
  runReleaseCommand,
  validateReleaseContext,
  verifyAndroidReleaseContext,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("../../scripts/release/android-release-context.cjs") as {
  EXPECTED_APP_VERSION: string;
  EXPECTED_BRANCH: string;
  EXPECTED_EAS_PROJECT_ID: string;
  EXPECTED_LINK_FIX_TEST_URL: string;
  EXPECTED_TRACKED_INSTRUMENTATION_PATHS: string[];
  REPO_ROOT: string;
  runReleaseCommand: (
    args: string[],
    dependencies: {
      repoRoot: string;
      verify: (input: { repoRoot: string }) => {
        repoRoot: string;
        branch: string;
        head: string;
        version: string;
      };
      spawn: jest.Mock;
    },
  ) => number;
  validateReleaseContext: (context: Record<string, unknown>) => unknown;
  verifyAndroidReleaseContext: (dependencies: {
    repoRoot: string;
    collectContext: jest.Mock;
    verifyInstrumentation: jest.Mock;
  }) => {
    repoRoot: string;
    branch: string;
    head: string;
    version: string;
  };
};
const {
  runBuild,
  runEas,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("../../scripts/eas-build.js") as {
  runBuild: (
    args: string[],
    dependencies: {
      repoRoot: string;
      verify: (input: { repoRoot: string }) => unknown;
      getHooksPath: (repoRoot: string) => string;
      unsetHooksPath: (repoRoot: string) => void;
      runEasCommand: (args: string[], options: { repoRoot: string }) => {
        status?: number;
        error?: Error;
      };
    },
  ) => number;
  runEas: (
    args: string[],
    dependencies: { repoRoot: string; spawn: jest.Mock },
  ) => { status?: number; error?: Error };
};

function createValidContext(repoRoot: string) {
  return {
    repoRoot,
    gitTopLevel: repoRoot,
    branch: EXPECTED_BRANCH,
    head: "abcdef0",
    status: "",
    trackedAndroidPaths: "",
    trackedInstrumentationPaths: `${EXPECTED_TRACKED_INSTRUMENTATION_PATHS.join("\n")}\n`,
    ignoredAndroidSettings: true,
    easIgnoreExists: false,
    androidSettingsExists: true,
    androidAppBuildExists: true,
    legacyCmakeInstallerExists: false,
    appConfig: {
      expo: {
        version: EXPECTED_APP_VERSION,
        extra: { eas: { projectId: EXPECTED_EAS_PROJECT_ID } },
        plugins: [
          "./plugins/with-android-drawing-order-fix",
          [
            "expo-build-properties",
            { android: { buildReactNativeFromSource: false } },
          ],
        ],
      },
    },
    easConfig: {
      build: {
        production: {
          env: { EXPO_PUBLIC_SENTRY_ENVIRONMENT: "production" },
        },
      },
    },
    packageJson: {
      scripts: {
        prepare: "node ./scripts/prepare.js",
      },
    },
    externalUrlSource: [
      "await Linking.openURL(normalized);",
      "if (!isHttpUrl(normalized)) throw error;",
      "await WebBrowser.openBrowserAsync(normalized);",
    ].join("\n"),
    externalUrlTestSource: [
      EXPECTED_LINK_FIX_TEST_URL,
      "expect(mockedCanOpenURL).not.toHaveBeenCalled();",
    ].join("\n"),
  };
}

describe("Android release context", () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "garamin-android-release-"));
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test("accepts only the exact clean prebuilt-instrumented 4.2.11 context", () => {
    expect(() =>
      validateReleaseContext(createValidContext(fixtureRoot)),
    ).not.toThrow();
  });

  test("pins the 4.2.11 app version on the existing release branch", () => {
    expect(EXPECTED_BRANCH).toBe(
      "release/garamin-4.2.8-link-fix-20260831",
    );
    expect(EXPECTED_APP_VERSION).toBe("4.2.11");
  });

  test("keeps the real build checkout version aligned with the release guard", () => {
    const appConfig = JSON.parse(readFileSync(join(REPO_ROOT, "app.json"), "utf8"));
    expect(appConfig.expo.version).toBe(EXPECTED_APP_VERSION);
    expect(appConfig.expo.runtimeVersion).toEqual({ policy: "appVersion" });
  });

  test("rejects messenger link opener or regression drift", () => {
    const legacyPreflight = createValidContext(fixtureRoot);
    legacyPreflight.externalUrlSource += "\nLinking.canOpenURL(normalized);";
    expect(() => validateReleaseContext(legacyPreflight)).toThrow(
      "capability preflight",
    );

    const missingFallback = createValidContext(fixtureRoot);
    missingFallback.externalUrlSource = "await Linking.openURL(normalized);";
    expect(() => validateReleaseContext(missingFallback)).toThrow(
      "direct-open or HTTP fallback contract",
    );

    const missingRegression = createValidContext(fixtureRoot);
    missingRegression.externalUrlTestSource = "";
    expect(() => validateReleaseContext(missingRegression)).toThrow(
      "regression coverage",
    );
  });

  test.each([
    ["wrong branch", { branch: "release/other" }, "Expected branch"],
    ["detached HEAD", { branch: "" }, "detached HEAD"],
    ["dirty tree", { status: " M app.json\n" }, "worktree is dirty"],
    [
      "tracked android",
      { trackedAndroidPaths: "android/settings.gradle\n" },
      "must remain untracked",
    ],
    [
      "missing tracked instrumentation source",
      {
        trackedInstrumentationPaths: `${EXPECTED_TRACKED_INSTRUMENTATION_PATHS.slice(0, -1).join("\n")}\n`,
      },
      "exact EAS archive contract",
    ],
    [
      "unexpected tracked instrumentation file",
      {
        trackedInstrumentationPaths: `${EXPECTED_TRACKED_INSTRUMENTATION_PATHS.join("\n")}\ngradle-plugins/react-android-drawing-order-guard/extra.gradle\n`,
      },
      "exact EAS archive contract",
    ],
    [
      "missing generated settings",
      { androidSettingsExists: false },
      "Gradle wiring is missing",
    ],
    [
      "missing generated app build",
      { androidAppBuildExists: false },
      "Gradle wiring is missing",
    ],
    [
      "unignored generated settings",
      { ignoredAndroidSettings: false },
      "Gradle wiring is missing",
    ],
    ["new easignore", { easIgnoreExists: true }, ".easignore"],
    [
      "wrong app version",
      { appConfig: { expo: { version: "4.2.4", plugins: [] } } },
      "Expected app version",
    ],
    [
      "missing prepare",
      { packageJson: { scripts: {} } },
      "no longer validates the instrumentation contract",
    ],
    [
      "legacy CMake installer",
      { legacyCmakeInstallerExists: true },
      "CMake bootstrap must remain removed",
    ],
    [
      "legacy CMake hook",
      {
        packageJson: {
          scripts: {
            prepare: "node ./scripts/prepare.js",
            "eas-build-post-install":
              "node ./scripts/eas/install-android-cmake.cjs",
          },
        },
      },
      "CMake bootstrap must remain removed",
    ],
    [
      "legacy CMake environment pin",
      {
        easConfig: {
          build: {
            production: { env: { CMAKE_VERSION: "3.30.5" } },
          },
        },
      },
      "CMake bootstrap must remain removed",
    ],
  ])("rejects %s", (_label, override, expectedMessage) => {
    expect(() =>
      validateReleaseContext({
        ...createValidContext(fixtureRoot),
        ...override,
      }),
    ).toThrow(expectedMessage as string);
  });

  test("rejects source-build true and the failed Expo plugin order", () => {
    const sourceBuildContext = createValidContext(fixtureRoot);
    sourceBuildContext.appConfig.expo.plugins[1] = [
      "expo-build-properties",
      { android: { buildReactNativeFromSource: true } },
    ];
    expect(() => validateReleaseContext(sourceBuildContext)).toThrow(
      "buildReactNativeFromSource=false",
    );

    const reversedContext = createValidContext(fixtureRoot);
    reversedContext.appConfig.expo.plugins.reverse();
    expect(() => validateReleaseContext(reversedContext)).toThrow(
      "before expo-build-properties",
    );
  });

  test("verifies generated settings and app wiring after context validation", () => {
    const collectContext = jest.fn(() => createValidContext(fixtureRoot));
    const verifyInstrumentation = jest.fn();

    expect(
      verifyAndroidReleaseContext({
        repoRoot: fixtureRoot,
        collectContext,
        verifyInstrumentation,
      }),
    ).toEqual({
      repoRoot: fixtureRoot,
      branch: EXPECTED_BRANCH,
      head: "abcdef0",
      version: EXPECTED_APP_VERSION,
    });
    expect(collectContext).toHaveBeenCalledWith(fixtureRoot);
    expect(verifyInstrumentation).toHaveBeenCalledWith({
      repoRoot: fixtureRoot,
      requireGeneratedAndroid: true,
    });
  });

  test("does not verify generated instrumentation when the context fails", () => {
    const invalidContext = createValidContext(fixtureRoot);
    invalidContext.androidAppBuildExists = false;
    const verifyInstrumentation = jest.fn();

    expect(() =>
      verifyAndroidReleaseContext({
        repoRoot: fixtureRoot,
        collectContext: jest.fn(() => invalidContext),
        verifyInstrumentation,
      }),
    ).toThrow("Gradle wiring is missing");
    expect(verifyInstrumentation).not.toHaveBeenCalled();
  });

  test("check mode verifies without spawning EAS", () => {
    const verify = jest.fn(() => ({
      repoRoot: fixtureRoot,
      branch: EXPECTED_BRANCH,
      head: "abcdef0",
      version: EXPECTED_APP_VERSION,
    }));
    const spawn = jest.fn();
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    expect(
      runReleaseCommand(["check"], {
        repoRoot: fixtureRoot,
        verify,
        spawn,
      }),
    ).toBe(0);
    expect(verify).toHaveBeenCalledWith({ repoRoot: fixtureRoot });
    expect(spawn).not.toHaveBeenCalled();
  });

  test("build mode pins cwd, platform and profile", () => {
    const verify = jest.fn(() => ({
      repoRoot: fixtureRoot,
      branch: EXPECTED_BRANCH,
      head: "abcdef0",
      version: EXPECTED_APP_VERSION,
    }));
    const spawn = jest.fn(() => ({ status: 7 }));
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    expect(
      runReleaseCommand(["build", "--non-interactive"], {
        repoRoot: fixtureRoot,
        verify,
        spawn,
      }),
    ).toBe(7);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        join(fixtureRoot, "scripts", "eas-build.js"),
        "android",
        "production",
        "--non-interactive",
      ],
      expect.objectContaining({ cwd: fixtureRoot, stdio: "inherit" }),
    );
  });

  test("build mode rejects platform and profile overrides", () => {
    const verify = jest.fn(() => ({
      repoRoot: fixtureRoot,
      branch: EXPECTED_BRANCH,
      head: "abcdef0",
      version: EXPECTED_APP_VERSION,
    }));
    const spawn = jest.fn();
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    expect(() =>
      runReleaseCommand(["build", "--profile", "preview"], {
        repoRoot: fixtureRoot,
        verify,
        spawn,
      }),
    ).toThrow("does not allow overriding --profile");
    expect(spawn).not.toHaveBeenCalled();
  });

  test("lower-level Android production invocation cannot bypass verification", () => {
    const verify = jest.fn(() => {
      throw new Error("blocked release context");
    });
    const runEasCommand = jest.fn();

    expect(() =>
      runBuild(["android", "production"], {
        repoRoot: fixtureRoot,
        verify,
        getHooksPath: jest.fn(() => ""),
        unsetHooksPath: jest.fn(),
        runEasCommand,
      }),
    ).toThrow("blocked release context");
    expect(verify).toHaveBeenCalledWith({ repoRoot: fixtureRoot });
    expect(runEasCommand).not.toHaveBeenCalled();
  });

  test("lower-level Android production invocation pins arguments after verification", () => {
    const verify = jest.fn();
    const runEasCommand = jest.fn(() => ({ status: 0 }));

    expect(
      runBuild(["android", "production", "--non-interactive"], {
        repoRoot: fixtureRoot,
        verify,
        getHooksPath: jest.fn(() => ""),
        unsetHooksPath: jest.fn(),
        runEasCommand,
      }),
    ).toBe(0);
    expect(runEasCommand).toHaveBeenCalledWith(
      [
        "build",
        "--platform",
        "android",
        "--profile",
        "production",
        "--non-interactive",
      ],
      { repoRoot: fixtureRoot },
    );
  });

  test("EAS arguments are passed without a Windows command shell", () => {
    const spawn = jest.fn(() => ({ status: 0 }));

    runEas(["build", "--message", "A & B"], {
      repoRoot: fixtureRoot,
      spawn,
    });

    expect(spawn).toHaveBeenLastCalledWith(
      process.execPath,
      [
        expect.stringMatching(/npx-cli\.js$/),
        "--yes",
        "eas-cli@18.3.0",
        "build",
        "--message",
        "A & B",
      ],
      expect.objectContaining({
        cwd: fixtureRoot,
        shell: false,
        stdio: "inherit",
      }),
    );
  });

  test("package and wrappers pin cwd while legacy CMake bootstrap stays absent", () => {
    const packageJson = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    );
    const easBuildSource = readFileSync(
      join(REPO_ROOT, "scripts", "eas-build.js"),
      "utf8",
    );
    const easConfig = JSON.parse(
      readFileSync(join(REPO_ROOT, "eas.json"), "utf8"),
    );

    expect(packageJson.scripts["eas:verify:android"]).toContain(
      "android-release-context.cjs check",
    );
    expect(packageJson.scripts["eas:build:android"]).toContain(
      "android-release-context.cjs build",
    );
    expect(packageJson.scripts["eas-build-post-install"]).toBeUndefined();
    expect(easConfig.build.production.env.CMAKE_VERSION).toBeUndefined();
    expect(
      existsSync(
        join(REPO_ROOT, "scripts", "eas", "install-android-cmake.cjs"),
      ),
    ).toBe(false);
    expect(easBuildSource).toContain(
      'const REPO_ROOT = path.resolve(__dirname, "..");',
    );
    expect(easBuildSource).toContain("verifyAndroidReleaseContext");
    expect(easBuildSource).toContain("shell: false");
    expect(easBuildSource).not.toContain("shell: true");
  });
});
