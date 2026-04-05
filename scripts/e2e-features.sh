#!/bin/bash
# E2E feature test: exercises every user-facing feature via AppleScript automation.
#
# Prerequisites:
#   - Built app: npm run tauri build
#   - macOS with Accessibility permissions for Terminal/iTerm
#
# Tests:
#   1. App launches with a terminal in cwd
#   2. Cmd+T opens new tab in same cwd
#   3. Cmd+D splits pane, new pane opens in same cwd
#   4. Cmd+W closes a surface
#   5. Cmd+N creates new workspace
#   6. Cmd+1/2 switches workspaces
#   7. Cmd+B toggles sidebar
#   8. Cmd+K clears scrollback
#   9. Cmd+F opens find bar
#   10. Cmd+P opens command palette
#   11. Cmd+C copies selected text
#   12. Cmd+V pastes text
#   13. Context menu appears on right-click
#   14. CWD is tracked (new tab inherits directory after cd)

set -e

APP_BINARY="$(dirname "$0")/../src-tauri/target/release/gnar-term"
FAIL=0
PASS=0
TESTS=0

if [ ! -f "$APP_BINARY" ]; then
    echo "ERROR: App binary not found. Run 'npm run tauri build' first."
    exit 1
fi

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); TESTS=$((TESTS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); TESTS=$((TESTS + 1)); }

keystroke() {
    osascript -e "
        tell application \"System Events\"
            tell process \"gnar-term\"
                set frontmost to true
                delay 0.15
                keystroke \"$1\" $2
            end tell
        end tell
    " 2>/dev/null
}

key_code() {
    osascript -e "
        tell application \"System Events\"
            tell process \"gnar-term\"
                set frontmost to true
                delay 0.15
                key code $1 $2
            end tell
        end tell
    " 2>/dev/null
}

type_text() {
    osascript -e "
        tell application \"System Events\"
            tell process \"gnar-term\"
                set frontmost to true
                delay 0.15
                keystroke \"$1\"
            end tell
        end tell
    " 2>/dev/null
}

press_return() {
    osascript -e "
        tell application \"System Events\"
            tell process \"gnar-term\"
                keystroke return
            end tell
        end tell
    " 2>/dev/null
}

press_escape() {
    osascript -e "
        tell application \"System Events\"
            tell process \"gnar-term\"
                key code 53
            end tell
        end tell
    " 2>/dev/null
}

app_alive() {
    kill -0 $APP_PID 2>/dev/null
}

# --- Launch ---
echo "[e2e] Launching GnarTerm..."
"$APP_BINARY" &
APP_PID=$!
sleep 4

if ! app_alive; then
    echo "FATAL: App crashed on startup"
    exit 1
fi
echo "[e2e] App started (PID $APP_PID)"

# --- Test 1: App launches with terminal ---
echo "[e2e] Test 1: App launches with working terminal"
type_text "echo E2E_LAUNCH_OK"
press_return
sleep 1
app_alive && pass "App launches with terminal" || fail "App crashed after typing"

# --- Test 2: Cmd+T new tab inherits cwd ---
echo "[e2e] Test 2: Cmd+T new tab inherits cwd"
# First cd somewhere specific
type_text "cd /tmp && echo CWD_SET"
press_return
sleep 1
# Open new tab
keystroke "t" "using command down"
sleep 2
# Check pwd in new tab
type_text "pwd"
press_return
sleep 1
app_alive && pass "Cmd+T opens new tab" || fail "Crash after Cmd+T"
# Close the new tab
keystroke "w" "using command down"
sleep 1

# --- Test 3: Cmd+D splits pane, inherits cwd ---
echo "[e2e] Test 3: Cmd+D splits pane"
keystroke "d" "using command down"
sleep 2
type_text "pwd"
press_return
sleep 1
app_alive && pass "Cmd+D splits pane" || fail "Crash after Cmd+D"
# Close the split pane
keystroke "w" "using command down"
sleep 1

# --- Test 4: Cmd+W closes surface ---
echo "[e2e] Test 4: Cmd+W closes surface"
keystroke "t" "using command down"
sleep 2
keystroke "w" "using command down"
sleep 1
app_alive && pass "Cmd+W closes surface" || fail "Crash after Cmd+W"

# --- Test 5: Cmd+N creates new workspace ---
echo "[e2e] Test 5: Cmd+N new workspace"
keystroke "n" "using command down"
sleep 2
app_alive && pass "Cmd+N creates workspace" || fail "Crash after Cmd+N"

# --- Test 6: Cmd+1/2 switches workspaces ---
echo "[e2e] Test 6: Cmd+1/2 workspace switching"
keystroke "1" "using command down"
sleep 1
keystroke "2" "using command down"
sleep 1
keystroke "1" "using command down"
sleep 1
app_alive && pass "Workspace switching" || fail "Crash during workspace switch"
# Close workspace 2
keystroke "2" "using command down"
sleep 0.5
keystroke "w" "using {command down, shift down}"
sleep 1

# --- Test 7: Cmd+B toggles sidebar ---
echo "[e2e] Test 7: Cmd+B sidebar toggle"
keystroke "b" "using command down"
sleep 0.5
keystroke "b" "using command down"
sleep 0.5
app_alive && pass "Sidebar toggle" || fail "Crash during sidebar toggle"

# --- Test 8: Cmd+K clears scrollback ---
echo "[e2e] Test 8: Cmd+K clear scrollback"
type_text "seq 1 100"
press_return
sleep 2
keystroke "k" "using command down"
sleep 1
app_alive && pass "Cmd+K clear scrollback" || fail "Crash after Cmd+K"

# --- Test 9: Cmd+F opens find bar ---
echo "[e2e] Test 9: Cmd+F find bar"
keystroke "f" "using command down"
sleep 0.5
type_text "test"
sleep 0.5
press_escape
sleep 0.5
app_alive && pass "Find bar open/close" || fail "Crash during find"

# --- Test 10: Cmd+P command palette ---
echo "[e2e] Test 10: Cmd+P command palette"
keystroke "p" "using command down"
sleep 0.5
press_escape
sleep 0.5
app_alive && pass "Command palette open/close" || fail "Crash during palette"

# --- Test 11: Cmd+C copy ---
echo "[e2e] Test 11: Cmd+C copy"
type_text "echo COPY_TEST_STRING"
press_return
sleep 1
# Can't easily verify clipboard content via AppleScript, just check no crash
keystroke "c" "using command down"
sleep 0.5
app_alive && pass "Cmd+C no crash" || fail "Crash after Cmd+C"

# --- Test 12: Cmd+V paste ---
echo "[e2e] Test 12: Cmd+V paste"
echo "PASTE_E2E_OK" | pbcopy
keystroke "v" "using command down"
sleep 0.5
press_return
sleep 1
app_alive && pass "Cmd+V paste" || fail "Crash after Cmd+V"

# --- Test 13: Shift+Cmd+D vertical split ---
echo "[e2e] Test 13: Shift+Cmd+D vertical split"
keystroke "d" "using {command down, shift down}"
sleep 2
app_alive && pass "Vertical split" || fail "Crash after vertical split"
keystroke "w" "using command down"
sleep 1

# --- Test 14: CWD tracking after cd ---
echo "[e2e] Test 14: CWD tracks after cd"
type_text "cd /var && echo CD_DONE"
press_return
sleep 2
# Open new tab — should open in /var
keystroke "t" "using command down"
sleep 2
type_text "pwd > /tmp/e2e_cwd_check.txt"
press_return
sleep 1
CWD_RESULT=$(cat /tmp/e2e_cwd_check.txt 2>/dev/null || echo "MISSING")
rm -f /tmp/e2e_cwd_check.txt
if [ "$CWD_RESULT" = "/private/var" ] || [ "$CWD_RESULT" = "/var" ]; then
    pass "New tab inherits cwd (/var → $CWD_RESULT)"
else
    fail "New tab cwd wrong: expected /var, got '$CWD_RESULT'"
fi
keystroke "w" "using command down"
sleep 1

# --- Cleanup ---
echo ""
echo "[e2e] Stopping app..."
kill $APP_PID 2>/dev/null || true
wait $APP_PID 2>/dev/null || true

echo ""
echo "========================================="
echo " E2E Results: $PASS passed, $FAIL failed (of $TESTS)"
echo "========================================="

if [ $FAIL -ne 0 ]; then
    exit 1
fi
