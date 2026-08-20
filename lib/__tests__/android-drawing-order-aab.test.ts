import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const verifier =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../../scripts/release/verify-android-drawing-order-aab.cjs") as {
    APK_ANALYZER_MAIN_CLASS: string;
    MAX_ANALYZER_OUTPUT_BYTES: number;
    MAX_PACKAGE_INVENTORY_OUTPUT_BYTES: number;
    TARGET_CLASS: string;
    TARGET_METHOD: string;
    analyzerOutputLimit: (args: string[]) => number;
    parseCliArgs: (
      argv: string[],
      options?: { cwd?: string; repoRoot?: string },
    ) => {
      help?: boolean;
      aabPath?: string;
      mappingPath?: string;
      sdkRoot?: string;
    };
    resolveAndroidSdkRoot: (options?: {
      sdkRoot?: string;
      env?: Record<string, string | undefined>;
      platform?: string;
    }) => string;
    resolveApkAnalyzerRuntime: (options?: {
      sdkRoot?: string;
      env?: Record<string, string | undefined>;
      platform?: string;
    }) => {
      javaExecutable: string;
      toolsDir: string;
      classpathJar: string;
    };
    runApkAnalyzer: (
      args: string[],
      options: {
        runtime: {
          javaExecutable: string;
          toolsDir: string;
          classpathJar: string;
        };
        spawn?: (
          executable: string,
          args: string[],
          options: Record<string, unknown>,
        ) => Record<string, unknown>;
        env?: Record<string, string | undefined>;
      },
    ) => string;
    runCli: (
      argv: string[],
      options?: {
        cwd?: string;
        repoRoot?: string;
        verify?: (options: Record<string, unknown>) => {
          dexFiles: string[];
        };
        log?: (message: string) => void;
      },
    ) => number;
    validateDexFileList: (output: string) => string[];
    validatePackageInventory: (output: string) => {
      classCount: number;
      methodCount: number;
    };
    validateStrictDexGuard: (output: string) => {
      fallbackLabel: string;
      resultRegister: string;
    };
    verifyAndroidDrawingOrderAab: (options: {
      aabPath: string;
      mappingPath: string;
      runAnalyzer?: (args: string[]) => string;
    }) => {
      aabPath: string;
      mappingPath: string;
      dexFiles: string[];
      classCount: number;
      methodCount: number;
      fallbackLabel: string;
      resultRegister: string;
    };
  };

const filesOutput = [
  "/base/manifest/AndroidManifest.xml",
  "/base/dex/classes.dex",
  "/base/dex/classes2.dex",
].join("\n");

const classLine = `C d 11\t15\t1007\t${verifier.TARGET_CLASS}`;
const methodLine = `M d 1\t1\t48\t${verifier.TARGET_CLASS} int getChildDrawingOrder(int,int)`;
const packagesOutput = [
  "Successfully loaded maps from: mapping.txt",
  "P d 11\t36\t1175\t<TOTAL>",
  classLine,
  methodLine,
].join("\n");

const codeOutput = `Successfully loaded maps from: mapping.txt
.method public getChildDrawingOrder(II)I
    .registers 4

    .line 40
    invoke-super {p0, p1, p2}, Landroidx/swiperefreshlayout/widget/SwipeRefreshLayout;->getChildDrawingOrder(II)I

    move-result v0

    if-ltz v0, :cond_9

    if-ge v0, p1, :cond_9

    return v0

    :cond_9
    return p2
.end method
`;

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function createArtifactFixture() {
  const directory = makeTemporaryDirectory("drawing-order-aab-");
  const aabPath = join(directory, "app-release.aab");
  const mappingPath = join(directory, "mapping.txt");
  writeFileSync(aabPath, "fixture-aab");
  writeFileSync(mappingPath, "fixture-mapping");
  return { aabPath, mappingPath };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
  jest.restoreAllMocks();
});

describe("final Android drawing-order AAB verification", () => {
  it("checks all base DEX files and accepts exactly one strict guarded method", () => {
    const fixture = createArtifactFixture();
    const calls: string[][] = [];
    const outputByCommand: Record<string, string> = {
      "files list": filesOutput,
      "dex code": codeOutput,
    };

    const result = verifier.verifyAndroidDrawingOrderAab({
      ...fixture,
      runAnalyzer(args) {
        calls.push(args);
        if (args[0] === "dex" && args[1] === "packages") {
          return args.includes("base/dex/classes.dex")
            ? packagesOutput
            : "P d 1\t1\t1\tfixture.empty";
        }
        return outputByCommand[args.slice(0, 2).join(" ")];
      },
    });

    expect(result).toMatchObject({
      dexFiles: ["/base/dex/classes.dex", "/base/dex/classes2.dex"],
      classCount: 1,
      methodCount: 1,
      fallbackLabel: ":cond_9",
      resultRegister: "v0",
    });
    expect(calls).toEqual([
      ["files", "list", "--files-only", resolve(fixture.aabPath)],
      [
        "dex",
        "packages",
        "--defined-only",
        "--files",
        "base/dex/classes.dex",
        "--proguard-mappings",
        resolve(fixture.mappingPath),
        resolve(fixture.aabPath),
      ],
      [
        "dex",
        "packages",
        "--defined-only",
        "--files",
        "base/dex/classes2.dex",
        "--proguard-mappings",
        resolve(fixture.mappingPath),
        resolve(fixture.aabPath),
      ],
      [
        "dex",
        "code",
        "--class",
        verifier.TARGET_CLASS,
        "--method",
        verifier.TARGET_METHOD,
        "--proguard-mappings",
        resolve(fixture.mappingPath),
        resolve(fixture.aabPath),
      ],
    ]);
  });

  it("fails when the AAB has no base DEX artifact", () => {
    expect(() =>
      verifier.validateDexFileList("/base/manifest/AndroidManifest.xml\n"),
    ).toThrow("does not contain a base/dex/classes*.dex artifact");
  });

  it.each([
    ["missing class", methodLine, /class.*found 0/i],
    ["duplicate class", `${classLine}\n${classLine}\n${methodLine}`, /class.*found 2/i],
    ["missing method", classLine, /method.*found 0/i],
    [
      "duplicate method",
      `${classLine}\n${methodLine}\n${methodLine}`,
      /method.*found 2/i,
    ],
  ])("rejects a %s definition inventory", (_name, output, message) => {
    expect(() => verifier.validatePackageInventory(output)).toThrow(message);
  });

  it.each([
    [
      "negative-index check",
      codeOutput.replace("if-ltz v0, :cond_9", "if-gez v0, :cond_9"),
      /negative-index fallback check/i,
    ],
    [
      "upper-bound check",
      codeOutput.replace("if-ge v0, p1, :cond_9", "if-ge v0, p2, :cond_9"),
      /childCount upper-bound/i,
    ],
    [
      "valid result return",
      codeOutput.replace("return v0", "return p1"),
      /valid superclass index/i,
    ],
    [
      "drawingPosition fallback",
      codeOutput.replace("return p2", "return p1"),
      /fallback does not return drawingPosition/i,
    ],
    [
      "shared fallback",
      codeOutput.replace("if-ge v0, p1, :cond_9", "if-ge v0, p1, :cond_a"),
      /upper-bound/i,
    ],
    [
      "extra instruction",
      codeOutput.replace("return v0", "const/4 v1, 0x0\n    return v0"),
      /unexpected instructions/i,
    ],
  ])("rejects a guard with an invalid %s", (_name, output, message) => {
    expect(() => verifier.validateStrictDexGuard(output)).toThrow(message);
  });

  it("allows R8 to add final while preserving the exact instruction skeleton", () => {
    expect(
      verifier.validateStrictDexGuard(
        codeOutput.replace(
          ".method public getChildDrawingOrder",
          ".method public final getChildDrawingOrder",
        ),
      ),
    ).toMatchObject({ fallbackLabel: ":cond_9", resultRegister: "v0" });
  });

  it.each([
    ["AAB", "missing.aab", "mapping.txt", /Release AAB does not exist/i],
    ["mapping", "present.aab", "missing.txt", /Release R8 mapping does not exist/i],
  ])("fails clearly when the %s artifact is absent", (_name, aab, mapping, message) => {
    const directory = makeTemporaryDirectory("drawing-order-missing-");
    if (aab === "present.aab") {
      writeFileSync(join(directory, aab), "fixture");
    }
    if (mapping === "mapping.txt") {
      writeFileSync(join(directory, mapping), "fixture");
    }

    expect(() =>
      verifier.verifyAndroidDrawingOrderAab({
        aabPath: join(directory, aab),
        mappingPath: join(directory, mapping),
        runAnalyzer: () => "",
      }),
    ).toThrow(message);
  });
});

describe("shell-free apkanalyzer execution", () => {
  const runtime = {
    javaExecutable: "java-fixture",
    toolsDir: "/android-sdk/cmdline-tools/latest",
    classpathJar: "/android-sdk/cmdline-tools/latest/lib/apkanalyzer-classpath.jar",
  };

  it("passes every analyzer argument directly to Java without a shell", () => {
    const spawn = jest.fn(
      (
        _executable: string,
        _args: string[],
        _options: Record<string, unknown>,
      ) => ({
        error: undefined,
        signal: null,
        status: 0,
        stderr: "",
        stdout: "verified-output",
      }),
    );
    const analyzerArgs = [
      "dex",
      "code",
      "--class",
      verifier.TARGET_CLASS,
      "--method",
      verifier.TARGET_METHOD,
      "C:\\safe path\\app-release.aab",
    ];

    expect(
      verifier.runApkAnalyzer(analyzerArgs, {
        runtime,
        spawn,
        env: { FIXTURE: "1" },
      }),
    ).toBe("verified-output");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][0]).toBe(runtime.javaExecutable);
    expect(spawn.mock.calls[0][1]).toEqual([
      `-Dcom.android.sdklib.toolsdir=${runtime.toolsDir}`,
      "-classpath",
      runtime.classpathJar,
      verifier.APK_ANALYZER_MAIN_CLASS,
      ...analyzerArgs,
    ]);
    expect(spawn.mock.calls[0][2]).toMatchObject({
      encoding: "utf8",
      maxBuffer: verifier.MAX_ANALYZER_OUTPUT_BYTES,
      shell: false,
      windowsHide: true,
    });
  });

  it("uses a larger but bounded buffer only for one-DEX package inventories", () => {
    expect(verifier.analyzerOutputLimit(["files", "list"])).toBe(
      verifier.MAX_ANALYZER_OUTPUT_BYTES,
    );
    expect(verifier.analyzerOutputLimit(["dex", "code"])).toBe(
      verifier.MAX_ANALYZER_OUTPUT_BYTES,
    );
    expect(verifier.analyzerOutputLimit(["dex", "packages"])).toBe(
      verifier.MAX_PACKAGE_INVENTORY_OUTPUT_BYTES,
    );
    expect(verifier.MAX_PACKAGE_INVENTORY_OUTPUT_BYTES).toBe(32 * 1024 * 1024);
  });

  it("reports Java startup failures clearly", () => {
    const spawn = jest.fn(() => ({
      error: new Error("spawn java ENOENT"),
      signal: null,
      status: null,
      stderr: "",
      stdout: "",
    }));
    expect(() =>
      verifier.runApkAnalyzer(["files", "list"], { runtime, spawn }),
    ).toThrow(/Unable to start shell-free apkanalyzer.*ENOENT/i);
  });

  it("reports bounded-buffer exhaustion without accepting the artifact", () => {
    const error = Object.assign(new Error("spawnSync java ENOBUFS"), {
      code: "ENOBUFS",
    });
    const spawn = jest.fn(() => ({
      error,
      signal: null,
      status: null,
      stderr: "",
      stdout: "partial inventory",
    }));
    expect(() =>
      verifier.runApkAnalyzer(["dex", "packages"], { runtime, spawn }),
    ).toThrow(/exceeded the bounded 32 MiB output limit.*without accepting/i);
  });

  it("reports non-zero analyzer exits with bounded diagnostics", () => {
    const spawn = jest.fn(() => ({
      error: undefined,
      signal: null,
      status: 7,
      stderr: "class not found",
      stdout: "",
    }));
    expect(() =>
      verifier.runApkAnalyzer(["dex", "code"], { runtime, spawn }),
    ).toThrow(/apkanalyzer dex code failed with exit code 7: class not found/i);
  });

  it("rejects NUL-bearing arguments before spawning Java", () => {
    const spawn = jest.fn();
    expect(() =>
      verifier.runApkAnalyzer(["files", "list", "bad\u0000path"], {
        runtime,
        spawn,
      }),
    ).toThrow(/NUL-free strings/i);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("Android SDK and CLI path handling", () => {
  it("rejects disagreeing Android SDK environment paths", () => {
    expect(() =>
      verifier.resolveAndroidSdkRoot({
        env: {
          ANDROID_HOME: "C:\\Android\\Sdk-A",
          ANDROID_SDK_ROOT: "C:\\Android\\Sdk-B",
        },
        platform: "win32",
      }),
    ).toThrow(/ANDROID_SDK_ROOT and ANDROID_HOME disagree/i);
  });

  it("fails clearly when the SDK has no apkanalyzer runtime", () => {
    const sdkRoot = makeTemporaryDirectory("drawing-order-sdk-");
    expect(() =>
      verifier.resolveApkAnalyzerRuntime({
        sdkRoot,
        env: {},
      }),
    ).toThrow(/apkanalyzer classpath does not exist/i);
  });

  it("resolves the shell-free Java runtime from an explicit SDK and JAVA_HOME", () => {
    const fixtureRoot = makeTemporaryDirectory("drawing-order-runtime-");
    const sdkRoot = join(fixtureRoot, "sdk");
    const javaHome = join(fixtureRoot, "jdk");
    const analyzerJar = join(
      sdkRoot,
      "cmdline-tools",
      "latest",
      "lib",
      "apkanalyzer-classpath.jar",
    );
    const javaExecutable = join(
      javaHome,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    );
    mkdirSync(join(sdkRoot, "cmdline-tools", "latest", "lib"), {
      recursive: true,
    });
    mkdirSync(join(javaHome, "bin"), { recursive: true });
    writeFileSync(analyzerJar, "fixture");
    writeFileSync(javaExecutable, "fixture");

    expect(
      verifier.resolveApkAnalyzerRuntime({
        sdkRoot,
        env: { JAVA_HOME: javaHome },
      }),
    ).toEqual({
      javaExecutable: resolve(javaExecutable),
      toolsDir: resolve(sdkRoot, "cmdline-tools", "latest"),
      classpathJar: resolve(analyzerJar),
    });
  });

  it("uses generated release artifacts by default and resolves safe overrides", () => {
    const repoRoot = resolve("D:/fixture/repository");
    const cwd = resolve("D:/fixture/invocation");
    expect(verifier.parseCliArgs([], { cwd, repoRoot })).toEqual({
      aabPath: resolve(
        repoRoot,
        "android/app/build/outputs/bundle/release/app-release.aab",
      ),
      mappingPath: resolve(
        repoRoot,
        "android/app/build/outputs/mapping/release/mapping.txt",
      ),
      sdkRoot: undefined,
    });
    expect(
      verifier.parseCliArgs(
        [
          "--aab",
          "artifacts/custom.aab",
          "--mapping",
          "artifacts/custom-map.txt",
          "--sdk-root",
          "sdk",
        ],
        { cwd, repoRoot },
      ),
    ).toEqual({
      aabPath: resolve(cwd, "artifacts/custom.aab"),
      mappingPath: resolve(cwd, "artifacts/custom-map.txt"),
      sdkRoot: resolve(cwd, "sdk"),
    });
  });

  it.each([
    [["--unknown", "value"], /Unknown argument/i],
    [["--aab"], /requires one NUL-free path/i],
    [["--aab", "--mapping"], /requires one NUL-free path/i],
    [["--aab", "one.aab", "--aab", "two.aab"], /Duplicate argument/i],
    [["--mapping", "bad\u0000path"], /NUL-free path/i],
  ])("rejects unsafe or ambiguous CLI arguments %#", (args, message) => {
    expect(() => verifier.parseCliArgs(args)).toThrow(message);
  });

  it("runs an override through the verifier without shell interpretation", () => {
    const cwd = makeTemporaryDirectory("drawing-order-cli-");
    const verify = jest.fn(() => ({ dexFiles: ["/base/dex/classes.dex"] }));
    const log = jest.fn();

    expect(
      verifier.runCli(
        ["--aab", "release.aab", "--mapping", "mapping.txt"],
        { cwd, verify, log },
      ),
    ).toBe(0);
    expect(verify).toHaveBeenCalledWith({
      aabPath: resolve(cwd, "release.aab"),
      mappingPath: resolve(cwd, "mapping.txt"),
      sdkRoot: undefined,
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Verified one guarded"),
    );
  });
});
