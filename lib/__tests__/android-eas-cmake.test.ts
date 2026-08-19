import { join, resolve } from "node:path";

const {
  CMAKE_PACKAGE,
  EXPECTED_CMAKE_VERSION,
  cmakeBinaryPath,
  ensureAndroidCmake,
  resolveAndroidSdkRoot,
  resolveSdkManagerPath,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("../../scripts/eas/install-android-cmake.cjs") as {
  CMAKE_PACKAGE: string;
  EXPECTED_CMAKE_VERSION: string;
  cmakeBinaryPath: (sdkRoot: string, platform?: string) => string;
  ensureAndroidCmake: (options: {
    env: Record<string, string | undefined>;
    platform: string;
    exists: (path: string) => boolean;
    spawn: jest.Mock;
    check?: boolean;
    log: jest.Mock;
  }) => {
    skipped: boolean;
    changed: boolean;
    cmakePath?: string;
  };
  resolveAndroidSdkRoot: (
    env: Record<string, string | undefined>,
    platform?: string,
  ) => string;
  resolveSdkManagerPath: (
    sdkRoot: string,
    options: { platform: string; exists: (path: string) => boolean },
  ) => string;
};

describe("EAS Android CMake bootstrap", () => {
  const sdkRoot = resolve("fixture-android-sdk");
  const cmakePath = cmakeBinaryPath(sdkRoot, "linux");
  const sdkManagerPath = join(
    sdkRoot,
    "cmdline-tools",
    "tools",
    "bin",
    "sdkmanager",
  );

  test("pins the exact React Native 0.81.5 CMake package", () => {
    expect(EXPECTED_CMAKE_VERSION).toBe("3.30.5");
    expect(CMAKE_PACKAGE).toBe("cmake;3.30.5");
  });

  test("skips outside Android EAS builds", () => {
    const spawn = jest.fn();
    const log = jest.fn();

    expect(
      ensureAndroidCmake({
        env: { EAS_BUILD_PLATFORM: "ios" },
        platform: "linux",
        exists: jest.fn(() => false),
        spawn,
        log,
      }),
    ).toEqual({ skipped: true, changed: false });
    expect(spawn).not.toHaveBeenCalled();
  });

  test("accepts an already installed exact CMake version", () => {
    const spawn = jest.fn(() => ({
      status: 0,
      stdout: "cmake version 3.30.5\n",
    }));

    expect(
      ensureAndroidCmake({
        env: { EAS_BUILD_PLATFORM: "android", ANDROID_HOME: sdkRoot },
        platform: "linux",
        exists: (candidate) => candidate === cmakePath,
        spawn,
        check: true,
        log: jest.fn(),
      }),
    ).toEqual({ skipped: false, changed: false, cmakePath });
    expect(spawn).toHaveBeenCalledWith(
      cmakePath,
      ["--version"],
      expect.objectContaining({ shell: false }),
    );
  });

  test("installs the exact package without a command shell", () => {
    let installed = false;
    const exists = (candidate: string) =>
      candidate === sdkManagerPath || (candidate === cmakePath && installed);
    const spawn = jest.fn((command: string) => {
      if (command === sdkManagerPath) {
        installed = true;
        return { status: 0 };
      }
      return { status: 0, stdout: "cmake version 3.30.5\n" };
    });

    expect(
      ensureAndroidCmake({
        env: { EAS_BUILD_PLATFORM: "android", ANDROID_HOME: sdkRoot },
        platform: "linux",
        exists,
        spawn,
        log: jest.fn(),
      }),
    ).toEqual({ skipped: false, changed: true, cmakePath });
    expect(spawn).toHaveBeenCalledWith(
      sdkManagerPath,
      ["--install", "cmake;3.30.5"],
      expect.objectContaining({ shell: false, stdio: "inherit" }),
    );
    expect(spawn).toHaveBeenCalledWith(
      cmakePath,
      ["--version"],
      expect.objectContaining({ shell: false }),
    );
  });

  test("fails closed when the SDK roots conflict", () => {
    expect(() =>
      resolveAndroidSdkRoot(
        {
          ANDROID_HOME: sdkRoot,
          ANDROID_SDK_ROOT: resolve("different-sdk"),
        },
        "linux",
      ),
    ).toThrow("point to different SDK roots");
  });

  test("fails closed when Gradle is configured for another CMake version", () => {
    expect(() =>
      ensureAndroidCmake({
        env: {
          EAS_BUILD_PLATFORM: "android",
          ANDROID_HOME: sdkRoot,
          CMAKE_VERSION: "3.22.1",
        },
        platform: "linux",
        exists: () => false,
        spawn: jest.fn(),
        log: jest.fn(),
      }),
    ).toThrow("CMAKE_VERSION must be 3.30.5");
  });

  test("fails closed when sdkmanager or installation is unavailable", () => {
    expect(() =>
      resolveSdkManagerPath(sdkRoot, {
        platform: "linux",
        exists: () => false,
      }),
    ).toThrow("Unable to locate sdkmanager");

    const spawn = jest.fn(() => ({ status: 1 }));
    expect(() =>
      ensureAndroidCmake({
        env: { EAS_BUILD_PLATFORM: "android", ANDROID_HOME: sdkRoot },
        platform: "linux",
        exists: (candidate) => candidate === sdkManagerPath,
        spawn,
        log: jest.fn(),
      }),
    ).toThrow("sdkmanager exited with status 1");
  });

  test("fails closed when the installed binary reports another version", () => {
    expect(() =>
      ensureAndroidCmake({
        env: { EAS_BUILD_PLATFORM: "android", ANDROID_HOME: sdkRoot },
        platform: "linux",
        exists: (candidate) => candidate === cmakePath,
        spawn: jest.fn(() => ({
          status: 0,
          stdout: "cmake version 3.22.1\n",
        })),
        check: true,
        log: jest.fn(),
      }),
    ).toThrow("Expected CMake 3.30.5, found 3.22.1");
  });
});
