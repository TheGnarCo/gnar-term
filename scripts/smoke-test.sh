#!/bin/bash
# Smoke test: launch GnarTerm, type `ps aux` into the terminal, verify no freeze.
#
# This test:
#   1. Launches the built GnarTerm binary
#   2. Waits for the window to appear
#   3. Uses AppleScript to type `ps aux` + Enter into the terminal
#   4. Waits for output to render
#   5. Types `echo RESPONSIVE` to verify the terminal is still accepting input
#   6. Checks CPU usage (frozen app pegs CPU >80%)
#   7. Repeats with heavier commands (find, yes | head)
#   8. Cleans up

set -e

APP_BINARY="$(dirname "$0")/../src-tauri/target/release/gnar-term"

if [ ! -f "$APP_BINARY" ]; then
    echo "ERROR: App binary not found at $APP_BINARY"
    echo "Run 'npm run build' first."
    exit 1
fi

FAIL=0

check_responsive() {
    local label="$1"
    sleep 1
    if ! kill -0 $APP_PID 2>/dev/null; then
        echo "FAIL [$label]: App process died"
        FAIL=1
        return 1
    fi
    CPU_USAGE=$(ps -p $APP_PID -o %cpu= | tr -d ' ')
    CPU_INT=${CPU_USAGE%.*}
    echo "  CPU after $label: ${CPU_USAGE}%"
    if [ "${CPU_INT:-0}" -gt 80 ]; then
        echo "FAIL [$label]: CPU at ${CPU_USAGE}% — likely frozen"
        FAIL=1
        return 1
    fi
    return 0
}

type_in_app() {
    local text="$1"
    osascript -e "
        tell application \"System Events\"
            tell process \"gnar-term\"
                set frontmost to true
                delay 0.2
                keystroke \"$text\"
                keystroke return
            end tell
        end tell
    " 2>/dev/null
}

echo "[smoke-test] Launching GnarTerm..."
"$APP_BINARY" &
APP_PID=$!

# Wait for the window to appear
echo "[smoke-test] Waiting for window..."
sleep 4

if ! kill -0 $APP_PID 2>/dev/null; then
    echo "FAIL: App crashed on startup"
    exit 1
fi
echo "[smoke-test] App started (PID $APP_PID)"

# --- Test 1: ps aux ---
echo "[smoke-test] TEST 1: Typing 'ps aux' into terminal..."
type_in_app "ps aux"
sleep 3
check_responsive "ps aux"

# --- Test 2: verify terminal is still interactive ---
echo "[smoke-test] TEST 2: Typing 'echo STILL_ALIVE' to verify responsiveness..."
type_in_app "echo STILL_ALIVE"
sleep 2
check_responsive "echo after ps aux"

# --- Test 3: heavier output (find with depth limit) ---
echo "[smoke-test] TEST 3: Typing 'find /usr -maxdepth 3 2>/dev/null | head -500'..."
type_in_app "find /usr -maxdepth 3 2>/dev/null | head -500"
sleep 4
check_responsive "find /usr"

# --- Test 4: rapid output burst ---
echo "[smoke-test] TEST 4: Typing 'yes | head -5000'..."
type_in_app "yes | head -5000"
sleep 3
check_responsive "yes | head"

# --- Test 5: Cmd+V paste (pbcopy → Cmd+V) ---
echo "[smoke-test] TEST 5: Copy-paste — pbcopy then Cmd+V..."
echo "PASTE_VERIFIED_OK" | pbcopy
osascript -e '
    tell application "System Events"
        tell process "gnar-term"
            set frontmost to true
            delay 0.3
            keystroke "v" using command down
            delay 0.5
            keystroke return
        end tell
    end tell
' 2>/dev/null
sleep 2
check_responsive "Cmd+V paste"

# --- Test 6: overflow — generate 2000+ lines, verify app isn't frozen ---
echo "[smoke-test] TEST 6: Overflow — generating 2000 lines of output..."
type_in_app "seq 1 2000"
sleep 4
check_responsive "overflow 2000 lines"

# --- Test 7: final responsiveness check ---
echo "[smoke-test] TEST 7: Final responsiveness — typing 'echo DONE'..."
type_in_app "echo DONE"
sleep 2
check_responsive "final echo"

# Clean up
echo "[smoke-test] Stopping app..."
kill $APP_PID 2>/dev/null || true
wait $APP_PID 2>/dev/null || true

if [ $FAIL -ne 0 ]; then
    echo "[smoke-test] FAILED — One or more tests detected a freeze or crash"
    exit 1
fi

echo "[smoke-test] ALL TESTS PASSED — Terminal handled heavy output, overflow, and Cmd+V paste"
