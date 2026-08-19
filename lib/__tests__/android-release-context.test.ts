import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  EXPECTED_APP_VERSION,
  EXPECTED_BRANCH,
  EXPECTED_EAS_PROJECT_ID,
  runReleaseCommand,
  validateReleaseContext,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("../../scripts/release/android-release-context.cjs") as {
  EXPECTED_APP_VERSION: string;
  EXPECTED_BRANCH: string;
  EXPECTED_EAS_PROJECT_ID: string;
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
    ignoredAndroidSettings: true,
    easIgnoreExists: false,
    androidSettingsExists: true,
    appConfig: {
      expo: {
        version: EXPECTED_APP_VERSION,
        extra: { eas: { projectId: EXPECTED_EAS_PROJECT_ID } },
        plugins: [
          "./plugins/with-android-drawing-order-fix",
          [
            "expo-build-properties",
            { android: { buildReactNativeFromSource: true } },
          ],
        ],
      },
    },
    packageJson: {
      scripts: { prepare: "node ./scripts/prepare.js" },
    },
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

  test("accepts only the exact clean 4.2.5 release context", () => {
    expect(() => validateReleaseContext(createValidContext(fixtureRoot))).not.toThrow();
  });

  test.each([
    ["wrong branch", { branch: "release/other" }, "Expected branch"],
    ["detached HEAD", { branch: "" }, "detached HEAD"],
    ["dirty tree", { status: " M app.json\n" }, "worktree is dirty"],
    ["tracked android", { trackedAndroidPaths: "android/settings.gradle\n" }, "must remain untracked"],
    ["missing generated settings", { androidSettingsExists: false }, "is missing"],
    ["unignored generated settings", { ignoredAndroidSettings: false }, "is missing"],
    ["new easignore", { easIgnoreExists: true }, ".easignore"],
    [
      "wrong app version",
      { appConfig: { expo: { version: "4.2.4", plugins: [] } } },
      "Expected app version",
    ],
    [
      "missing prepare",
      { packageJson: { scripts: {} } },
      "no longer runs the native patch",
    ],
  ])("rejects %s", (_label, override, expectedMessage) => {
    expect(() =>
      validateReleaseContext({
        ...createValidContext(fixtureRoot),
        ...override,
      }),
    ).toThrow(expectedMessage as string);
  });

  test("rejects the failed EAS plugin order", () => {
    const context = createValidContext(fixtureRoot);
    context.appConfig.expo.plugins.reverse();

    expect(() => validateReleaseContext(context)).toThrow(
      "before expo-build-properties",
    );
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

  test("package and lower-level EAS wrapper keep the candidate cwd pinned", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );
    const easBuildSource = readFileSync(
      join(process.cwd(), "scripts", "eas-build.js"),
      "utf8",
    );

    expect(packageJson.scripts["eas:verify:android"]).toContain(
      "android-release-context.cjs check",
    );
    expect(packageJson.scripts["eas:build:android"]).toContain(
      "android-release-context.cjs build",
    );
    expect(easBuildSource).toContain(
      'const REPO_ROOT = path.resolve(__dirname, "..");',
    );
    expect(easBuildSource).toContain("verifyAndroidReleaseContext");
    expect(easBuildSource).toContain("shell: false");
    expect(easBuildSource).not.toContain("shell: true");
  });
});
