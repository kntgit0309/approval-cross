#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────────
# Đóng gói hdld-tool (:3502) thành launchd service trên Mac mini —
# tự bật lại sau reboot/crash (KeepAlive), giống pattern hr/dxc/track.
#
# CHẠY TRÊN MAC MINI:   bash ~/hdld-tool/install-launchd.sh
#
# Secret KHÔNG nằm trong code:
#   - Lark: lark-cli profile (LARK_PROFILE) đã config sẵn trên mini
#   - Google: service account JSON (GOOGLE_SA_KEY) đặt ngoài repo
# Quản lý:
#   restart:  launchctl kickstart -k gui/$(id -u)/com.hdld-tool.server
#   gỡ:       launchctl bootout  gui/$(id -u) ~/Library/LaunchAgents/com.hdld-tool.server.plist
#   log:      tail -f ~/hdld-tool/server.log
# ───────────────────────────────────────────────────────────────────────────
set -e

NODE="${NODE:-/opt/homebrew/bin/node}"
APP="${APP:-$HOME/hdld-tool}"
PORT="${PORT:-3502}"
LARK_PROFILE="${LARK_PROFILE:-cli_a80df38cc639d02f}"
LARK_CLI="${LARK_CLI:-/opt/homebrew/bin/lark-cli}"
GOOGLE_SA_KEY="${GOOGLE_SA_KEY:-$APP/sa-key.json}"
GOOGLE_DEST_FOLDER_ID="${GOOGLE_DEST_FOLDER_ID:-}"
TEMPLATE_DOC_OVERRIDE="${TEMPLATE_DOC_OVERRIDE:-}"
HDLD_TOKEN="${HDLD_TOKEN:-}"

LABEL="com.hdld-tool.server"
LA="$HOME/Library/LaunchAgents"
PLIST="$LA/$LABEL.plist"
U="$(id -u)"
mkdir -p "$LA"

[ -x "$NODE" ] || { echo "✗ không thấy node ở $NODE (set NODE=...)"; exit 1; }
[ -f "$APP/server.js" ] || { echo "✗ không thấy $APP/server.js (set APP=...)"; exit 1; }
[ -f "$GOOGLE_SA_KEY" ] || echo "⚠ chưa thấy service account ở $GOOGLE_SA_KEY — set GOOGLE_SA_KEY=..."

# Dừng instance đang chiếm port (nếu có) để launchd nắm port
lsof -ti tcp:"$PORT" 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

OPT_ENV=""
[ -n "$GOOGLE_DEST_FOLDER_ID" ] && OPT_ENV="$OPT_ENV    <key>GOOGLE_DEST_FOLDER_ID</key><string>$GOOGLE_DEST_FOLDER_ID</string>\n"
[ -n "$TEMPLATE_DOC_OVERRIDE" ] && OPT_ENV="$OPT_ENV    <key>TEMPLATE_DOC_OVERRIDE</key><string>$TEMPLATE_DOC_OVERRIDE</string>\n"
[ -n "$HDLD_TOKEN" ] && OPT_ENV="$OPT_ENV    <key>HDLD_TOKEN</key><string>$HDLD_TOKEN</string>\n"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$APP/server.js</string></array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PORT</key><string>$PORT</string>
    <key>LARK_PROFILE</key><string>$LARK_PROFILE</string>
    <key>LARK_CLI</key><string>$LARK_CLI</string>
    <key>GOOGLE_SA_KEY</key><string>$GOOGLE_SA_KEY</string>
$(printf "$OPT_ENV")  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$APP/server.log</string>
  <key>StandardErrorPath</key><string>$APP/server.log</string>
</dict></plist>
PL
echo "✓ plist: $PLIST"

launchctl bootout gui/"$U" "$PLIST" 2>/dev/null || true
launchctl bootstrap gui/"$U" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
sleep 2

if launchctl list | grep -q "$LABEL"; then echo "✓ launchd đang chạy: $LABEL"; else echo "⚠ chưa thấy trong launchctl list"; fi
echo -n "✓ health: "; curl -s "http://127.0.0.1:$PORT/" | head -c 120; echo
echo "Done."
