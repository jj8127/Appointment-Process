#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-start}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

show_usage() {
  cat <<'USAGE'
usage: ./script/build_and_run.sh [mode]

Modes:
  start, run        Start the Expo dev server
  --ios, ios        Start Expo and open iOS
  --android, android
                   Start Expo and open Android
  --web, web        Start Expo for web
  --dev-client, dev-client
                   Start Expo in development-client mode
  --tunnel, tunnel Start Expo using tunnel transport
  --export-web, export-web
                   Export the web build locally
  --doctor, doctor Run Expo diagnostics
  --help, help     Show this help
USAGE
}

resolve_expo_cmd() {
  if [[ -n "${EXPO_CLI:-}" ]]; then
    # Optional escape hatch for projects that need a wrapper command.
    # shellcheck disable=SC2206
    EXPO_CMD=(${EXPO_CLI})
    return
  fi

  if [[ -f pnpm-lock.yaml ]] && command -v pnpm >/dev/null 2>&1; then
    EXPO_CMD=(pnpm exec expo)
  elif [[ -f yarn.lock ]] && command -v yarn >/dev/null 2>&1; then
    EXPO_CMD=(yarn expo)
  elif { [[ -f bun.lock ]] || [[ -f bun.lockb ]]; } && command -v bun >/dev/null 2>&1; then
    EXPO_CMD=(bunx expo)
  else
    EXPO_CMD=(npx expo)
  fi
}

run_doctor() {
  if [[ -f pnpm-lock.yaml ]] && command -v pnpm >/dev/null 2>&1; then
    pnpm exec expo-doctor
  elif [[ -f yarn.lock ]] && command -v yarn >/dev/null 2>&1; then
    yarn expo-doctor
  elif { [[ -f bun.lock ]] || [[ -f bun.lockb ]]; } && command -v bun >/dev/null 2>&1; then
    bunx expo-doctor
  else
    npx expo-doctor
  fi
}

resolve_free_port() {
  local default_port="8081"

  case "$MODE" in
    --web|web)
      default_port="3200"
      ;;
  esac

  local preferred_port="${EXPO_START_PORT:-$default_port}"

  EXPO_PORT="$(node -e '
    const net = require("net");
    const start = Number(process.argv[1] || 8081);

    function tryPort(port) {
      const server = net.createServer();
      server.once("error", () => tryPort(port + 1));
      server.once("listening", () => {
        server.close(() => process.stdout.write(String(port)));
      });
      server.listen(port);
    }

    tryPort(start);
  ' "$preferred_port")"
}

resolve_expo_cmd
resolve_free_port

case "$MODE" in
  start|run)
    exec "${EXPO_CMD[@]}" start --port "$EXPO_PORT"
    ;;
  --ios|ios)
    exec "${EXPO_CMD[@]}" start --ios --port "$EXPO_PORT"
    ;;
  --android|android)
    exec "${EXPO_CMD[@]}" start --android --port "$EXPO_PORT"
    ;;
  --web|web)
    exec "${EXPO_CMD[@]}" start --web --port "$EXPO_PORT"
    ;;
  --dev-client|dev-client)
    exec "${EXPO_CMD[@]}" start --dev-client --port "$EXPO_PORT"
    ;;
  --tunnel|tunnel)
    exec "${EXPO_CMD[@]}" start --tunnel --port "$EXPO_PORT"
    ;;
  --export-web|export-web)
    exec "${EXPO_CMD[@]}" export --platform web
    ;;
  --doctor|doctor)
    run_doctor
    ;;
  --help|help)
    show_usage
    ;;
  *)
    show_usage >&2
    exit 2
    ;;
esac
