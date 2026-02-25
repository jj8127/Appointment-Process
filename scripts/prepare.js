#!/usr/bin/env node

const { execSync } = require("node:child_process");

function run(command) {
  return execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runIgnore(command) {
  execSync(command, { stdio: "ignore" });
}

function inGitRepository() {
  try {
    return run("git rev-parse --is-inside-work-tree") === "true";
  } catch {
    return false;
  }
}

function getLocalHooksPath() {
  try {
    return run("git config --local --get core.hooksPath");
  } catch {
    return "";
  }
}

function unsetLocalHooksPath() {
  try {
    runIgnore("git config --local --unset core.hooksPath");
  } catch {
    // no-op
  }
}

function installHusky() {
  execSync("npx husky", { stdio: "inherit" });
}

if (!inGitRepository()) {
  process.exit(0);
}

if (process.env.ENABLE_HUSKY === "1") {
  installHusky();
  process.exit(0);
}

const hooksPath = getLocalHooksPath();
if (!hooksPath) {
  process.exit(0);
}

if (hooksPath.startsWith(".husky")) {
  unsetLocalHooksPath();
  console.log(
    "[prepare] Removed local core.hooksPath (.husky*) to keep EAS file clone compatible.",
  );
  console.log(
    "[prepare] To enable husky hooks again, set ENABLE_HUSKY=1 and run npm install.",
  );
}
