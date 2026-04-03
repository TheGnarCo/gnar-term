#!/bin/bash
# Run GnarTerm headless in Docker for testing
# Usage: ./scripts/test-headless.sh [timeout_seconds]

TIMEOUT=${1:-10}

docker run --rm \
  -v "$(pwd)":/app \
  -v gnarterm-cargo-cache:/usr/local/cargo/registry \
  -v gnarterm-target-cache:/app/src-tauri/target \
  -w /app \
  gnarterm-run \
  bash -c "
    Xvfb :99 -screen 0 1280x720x24 &
    export DISPLAY=:99
    sleep 1
    eval \$(dbus-launch --sh-syntax)
    npm install --silent 2>/dev/null
    npx vite build 2>&1 | tail -1
    cd src-tauri
    cargo build 2>&1 | tail -3
    echo '=== LAUNCHING ==='
    timeout $TIMEOUT ./target/debug/gnar-term 2>&1
    echo \"EXIT CODE: \$?\"
  "
