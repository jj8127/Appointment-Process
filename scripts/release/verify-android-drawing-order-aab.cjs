#!/usr/bin/env node
/* global __dirname */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_AAB_PATH = path.join(
  REPO_ROOT,
  "android",
  "app",
  "build",
  "outputs",
  "bundle",
  "release",
  "app-release.aab",
);
const DEFAULT_MAPPING_PATH = path.join(
  REPO_ROOT,
  "android",
  "app",
  "build",
  "outputs",
  "mapping",
  "release",
  "mapping.txt",
);
const TARGET_CLASS =
  "com.facebook.react.views.swiperefresh.ReactSwipeRefreshLayout";
const TARGET_METHOD = "getChildDrawingOrder(II)I";
const APK_ANALYZER_MAIN_CLASS =
  "com.android.tools.apk.analyzer.ApkAnalyzerCli";
const MAX_ANALYZER_OUTPUT_BYTES = 16 * 1024 * 1024;

function fail(message) {
  throw new Error(`[android-drawing-order-aab] ${message}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function comparablePath(value, platform = process.platform) {
  const resolved = path.resolve(value).replace(/[\\/]+$/, "");
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertRegularFile(label, filePath, fsModule = fs) {
  let stat;
  try {
    stat = fsModule.statSync(filePath);
  } catch {
    fail(`${label} does not exist: ${filePath}`);
  }
  if (!stat.isFile()) {
    fail(`${label} is not a file: ${filePath}`);
  }
}

function assertDirectory(label, directoryPath, fsModule = fs) {
  let stat;
  try {
    stat = fsModule.statSync(directoryPath);
  } catch {
    fail(`${label} does not exist: ${directoryPath}`);
  }
  if (!stat.isDirectory()) {
    fail(`${label} is not a directory: ${directoryPath}`);
  }
}

function resolveAndroidSdkRoot({
  sdkRoot,
  env = process.env,
  fsModule = fs,
  platform = process.platform,
} = {}) {
  let selectedRoot;
  if (sdkRoot) {
    selectedRoot = sdkRoot;
  } else {
    const sdkRootFromEnvironment = env.ANDROID_SDK_ROOT?.trim();
    const androidHome = env.ANDROID_HOME?.trim();
    if (
      sdkRootFromEnvironment &&
      androidHome &&
      comparablePath(sdkRootFromEnvironment, platform) !==
        comparablePath(androidHome, platform)
    ) {
      fail(
        `ANDROID_SDK_ROOT and ANDROID_HOME disagree: ${sdkRootFromEnvironment} != ${androidHome}`,
      );
    }
    selectedRoot = sdkRootFromEnvironment || androidHome;
    if (!selectedRoot && platform === "win32" && env.LOCALAPPDATA) {
      selectedRoot = path.join(env.LOCALAPPDATA, "Android", "Sdk");
    }
  }

  if (!selectedRoot || selectedRoot.trim().length === 0) {
    fail(
      "Android SDK path is unavailable; set ANDROID_SDK_ROOT or ANDROID_HOME.",
    );
  }

  const resolvedRoot = path.resolve(selectedRoot);
  assertDirectory("Android SDK root", resolvedRoot, fsModule);
  return resolvedRoot;
}

function resolveJavaExecutable({
  env = process.env,
  fsModule = fs,
  platform = process.platform,
} = {}) {
  const executableName = platform === "win32" ? "java.exe" : "java";
  const javaHome = env.JAVA_HOME?.trim();
  if (!javaHome) {
    return executableName;
  }

  const executable = path.resolve(javaHome, "bin", executableName);
  assertRegularFile("JAVA_HOME Java executable", executable, fsModule);
  return executable;
}

function resolveApkAnalyzerRuntime({
  sdkRoot,
  env = process.env,
  fsModule = fs,
  platform = process.platform,
} = {}) {
  const resolvedSdkRoot = resolveAndroidSdkRoot({
    sdkRoot,
    env,
    fsModule,
    platform,
  });
  const cmdlineToolsRoot = path.join(
    resolvedSdkRoot,
    "cmdline-tools",
    "latest",
  );
  const classpathJar = path.join(
    cmdlineToolsRoot,
    "lib",
    "apkanalyzer-classpath.jar",
  );
  assertRegularFile("apkanalyzer classpath", classpathJar, fsModule);

  return {
    javaExecutable: resolveJavaExecutable({ env, fsModule, platform }),
    toolsDir: cmdlineToolsRoot,
    classpathJar,
  };
}

function summarizeCommandFailure(result) {
  const diagnostic = [result.stderr, result.stdout]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .trim();
  if (!diagnostic) {
    return "no diagnostic output";
  }
  return diagnostic.slice(0, 2_000);
}

function runApkAnalyzer(
  analyzerArgs,
  { runtime, spawn = spawnSync, env = process.env } = {},
) {
  if (!runtime) {
    fail("apkanalyzer runtime was not resolved.");
  }
  if (
    !Array.isArray(analyzerArgs) ||
    analyzerArgs.some(
      (value) => typeof value !== "string" || value.includes("\u0000"),
    )
  ) {
    fail("apkanalyzer arguments must be NUL-free strings.");
  }

  const result = spawn(
    runtime.javaExecutable,
    [
      `-Dcom.android.sdklib.toolsdir=${runtime.toolsDir}`,
      "-classpath",
      runtime.classpathJar,
      APK_ANALYZER_MAIN_CLASS,
      ...analyzerArgs,
    ],
    {
      encoding: "utf8",
      env,
      maxBuffer: MAX_ANALYZER_OUTPUT_BYTES,
      shell: false,
      windowsHide: true,
    },
  );

  if (result.error) {
    fail(`Unable to start shell-free apkanalyzer: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const command = analyzerArgs.slice(0, 2).join(" ") || "unknown";
    const exitDescription =
      typeof result.status === "number"
        ? `exit code ${result.status}`
        : `signal ${result.signal || "unknown"}`;
    fail(
      `apkanalyzer ${command} failed with ${exitDescription}: ${summarizeCommandFailure(result)}`,
    );
  }

  return typeof result.stdout === "string" ? result.stdout : "";
}

function splitOutputLines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function validateDexFileList(output) {
  const dexFiles = splitOutputLines(output).filter((line) =>
    /^\/base\/dex\/classes(?:\d+)?\.dex$/.test(line),
  );
  if (dexFiles.length === 0) {
    fail("AAB does not contain a base/dex/classes*.dex artifact.");
  }
  return dexFiles;
}

function validatePackageInventory(output) {
  const lines = splitOutputLines(output);
  const escapedClass = escapeRegExp(TARGET_CLASS);
  const classPattern = new RegExp(
    `^C\\s+d\\s+\\d+\\s+\\d+\\s+\\d+\\s+${escapedClass}$`,
  );
  const methodPattern = new RegExp(
    `^M\\s+d\\s+\\d+\\s+\\d+\\s+\\d+\\s+${escapedClass}\\s+int\\s+getChildDrawingOrder\\(int,int\\)$`,
  );
  const classCount = lines.filter((line) => classPattern.test(line)).length;
  const methodCount = lines.filter((line) => methodPattern.test(line)).length;

  if (classCount !== 1) {
    fail(
      `Expected exactly one target class definition (${TARGET_CLASS}) across all DEX files; found ${classCount}.`,
    );
  }
  if (methodCount !== 1) {
    fail(
      `Expected exactly one target method definition (${TARGET_CLASS}.${TARGET_METHOD}) across all DEX files; found ${methodCount}.`,
    );
  }

  return { classCount, methodCount };
}

function validateStrictDexGuard(output) {
  const lines = splitOutputLines(output);
  const methodStarts = lines
    .map((line, index) => (line.startsWith(".method ") ? index : -1))
    .filter((index) => index >= 0);
  const methodEnds = lines
    .map((line, index) => (line === ".end method" ? index : -1))
    .filter((index) => index >= 0);

  if (methodStarts.length !== 1 || methodEnds.length !== 1) {
    fail(
      `Expected one disassembled method block; found ${methodStarts.length} starts and ${methodEnds.length} ends.`,
    );
  }
  const start = methodStarts[0];
  const end = methodEnds[0];
  if (end <= start) {
    fail("Disassembled method block is malformed.");
  }

  const unexpectedOutsideLines = [
    ...lines.slice(0, start),
    ...lines.slice(end + 1),
  ].filter((line) => !line.startsWith("Successfully loaded maps from:"));
  if (unexpectedOutsideLines.length > 0) {
    fail(
      `Unexpected apkanalyzer output outside the method block: ${unexpectedOutsideLines[0]}`,
    );
  }

  const methodBlock = lines.slice(start, end + 1);
  const registerDeclarations = methodBlock.filter((line) =>
    line.startsWith(".registers "),
  );
  if (
    registerDeclarations.length !== 1 ||
    registerDeclarations[0] !== ".registers 4"
  ) {
    fail(
      `Expected the guarded method to declare exactly four registers; found ${registerDeclarations.join(", ") || "none"}.`,
    );
  }

  const skeleton = methodBlock.filter(
    (line) =>
      !line.startsWith(".line ") && !line.startsWith(".registers "),
  );
  if (skeleton.length !== 9) {
    fail(
      `Guarded DEX method has unexpected instructions; expected 9 skeleton lines, found ${skeleton.length}.`,
    );
  }
  if (
    !/^\.method public(?: final)? getChildDrawingOrder\(II\)I$/.test(
      skeleton[0],
    )
  ) {
    fail(`Unexpected guarded method declaration: ${skeleton[0] || "missing"}`);
  }
  if (
    skeleton[1] !==
    "invoke-super {p0, p1, p2}, Landroidx/swiperefreshlayout/widget/SwipeRefreshLayout;->getChildDrawingOrder(II)I"
  ) {
    fail("Guarded method does not invoke the expected superclass method once.");
  }

  const moveResultMatch = /^move-result (v\d+)$/.exec(skeleton[2]);
  if (!moveResultMatch) {
    fail("Guarded method does not capture the superclass drawing index.");
  }
  const resultRegister = moveResultMatch[1];
  const lowerBoundMatch = new RegExp(
    `^if-ltz ${escapeRegExp(resultRegister)}, (:[A-Za-z0-9_$]+)$`,
  ).exec(skeleton[3]);
  if (!lowerBoundMatch) {
    fail("Guarded method is missing the negative-index fallback check.");
  }
  const fallbackLabel = lowerBoundMatch[1];
  if (
    skeleton[4] !==
    `if-ge ${resultRegister}, p1, ${fallbackLabel}`
  ) {
    fail("Guarded method is missing the childCount upper-bound fallback check.");
  }
  if (skeleton[5] !== `return ${resultRegister}`) {
    fail("Guarded method does not return the valid superclass index.");
  }
  if (skeleton[6] !== fallbackLabel) {
    fail("Guarded method bounds checks do not share one fallback target.");
  }
  if (skeleton[7] !== "return p2") {
    fail("Guarded method fallback does not return drawingPosition.");
  }
  if (skeleton[8] !== ".end method") {
    fail("Guarded method does not end at the expected boundary.");
  }

  return { fallbackLabel, resultRegister };
}

function verifyAnalyzerOutputs({
  filesOutput,
  packagesOutput,
  codeOutput,
}) {
  return {
    dexFiles: validateDexFileList(filesOutput),
    ...validatePackageInventory(packagesOutput),
    ...validateStrictDexGuard(codeOutput),
  };
}

function verifyAndroidDrawingOrderAab({
  aabPath = DEFAULT_AAB_PATH,
  mappingPath = DEFAULT_MAPPING_PATH,
  sdkRoot,
  env = process.env,
  fsModule = fs,
  spawn = spawnSync,
  runAnalyzer,
} = {}) {
  const resolvedAabPath = path.resolve(aabPath);
  const resolvedMappingPath = path.resolve(mappingPath);
  if (path.extname(resolvedAabPath).toLowerCase() !== ".aab") {
    fail(`Android bundle path must end in .aab: ${resolvedAabPath}`);
  }
  assertRegularFile("Release AAB", resolvedAabPath, fsModule);
  assertRegularFile("Release R8 mapping", resolvedMappingPath, fsModule);

  let analyzer = runAnalyzer;
  if (!analyzer) {
    const runtime = resolveApkAnalyzerRuntime({
      sdkRoot,
      env,
      fsModule,
    });
    analyzer = (args) =>
      runApkAnalyzer(args, { runtime, spawn, env });
  }

  const filesOutput = analyzer([
    "files",
    "list",
    "--files-only",
    resolvedAabPath,
  ]);
  const packagesOutput = analyzer([
    "dex",
    "packages",
    "--defined-only",
    "--proguard-mappings",
    resolvedMappingPath,
    resolvedAabPath,
  ]);
  const codeOutput = analyzer([
    "dex",
    "code",
    "--class",
    TARGET_CLASS,
    "--method",
    TARGET_METHOD,
    "--proguard-mappings",
    resolvedMappingPath,
    resolvedAabPath,
  ]);

  return {
    aabPath: resolvedAabPath,
    mappingPath: resolvedMappingPath,
    ...verifyAnalyzerOutputs({ filesOutput, packagesOutput, codeOutput }),
  };
}

function readPathArgument(argv, index, flag) {
  const value = argv[index + 1];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("--") ||
    value.includes("\u0000")
  ) {
    fail(`${flag} requires one NUL-free path argument.`);
  }
  return value;
}

function parseCliArgs(
  argv,
  { cwd = process.cwd(), repoRoot = REPO_ROOT } = {},
) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return { help: true };
  }

  const values = new Map();
  const allowedFlags = new Set(["--aab", "--mapping", "--sdk-root"]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!allowedFlags.has(flag)) {
      fail(`Unknown argument: ${flag || "<empty>"}`);
    }
    if (values.has(flag)) {
      fail(`Duplicate argument: ${flag}`);
    }
    values.set(flag, readPathArgument(argv, index, flag));
  }

  return {
    aabPath: values.has("--aab")
      ? path.resolve(cwd, values.get("--aab"))
      : path.resolve(
          repoRoot,
          "android/app/build/outputs/bundle/release/app-release.aab",
        ),
    mappingPath: values.has("--mapping")
      ? path.resolve(cwd, values.get("--mapping"))
      : path.resolve(
          repoRoot,
          "android/app/build/outputs/mapping/release/mapping.txt",
        ),
    sdkRoot: values.has("--sdk-root")
      ? path.resolve(cwd, values.get("--sdk-root"))
      : undefined,
  };
}

function usage() {
  return [
    "Usage: verify-android-drawing-order-aab.cjs",
    "  [--aab <release.aab>]",
    "  [--mapping <mapping.txt>]",
    "  [--sdk-root <android-sdk>]",
  ].join("\n");
}

function runCli(
  argv,
  {
    cwd = process.cwd(),
    repoRoot = REPO_ROOT,
    verify = verifyAndroidDrawingOrderAab,
    log = console.log,
  } = {},
) {
  const options = parseCliArgs(argv, { cwd, repoRoot });
  if (options.help) {
    log(usage());
    return 0;
  }

  const result = verify(options);
  log(
    `[android-drawing-order-aab] Verified one guarded ${TARGET_CLASS}.${TARGET_METHOD} across ${result.dexFiles.length} base DEX file(s).`,
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  APK_ANALYZER_MAIN_CLASS,
  DEFAULT_AAB_PATH,
  DEFAULT_MAPPING_PATH,
  REPO_ROOT,
  TARGET_CLASS,
  TARGET_METHOD,
  parseCliArgs,
  resolveAndroidSdkRoot,
  resolveApkAnalyzerRuntime,
  resolveJavaExecutable,
  runApkAnalyzer,
  runCli,
  usage,
  validateDexFileList,
  validatePackageInventory,
  validateStrictDexGuard,
  verifyAnalyzerOutputs,
  verifyAndroidDrawingOrderAab,
};
