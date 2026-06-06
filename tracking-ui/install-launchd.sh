#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────────
# Đóng gói tracking server (:3400) thành launchd service trên Mac mini —
# tự bật lại sau reboot/crash (KeepAlive), giống pattern hr/dxc.
#
# CHẠY TRÊN MAC MINI:   bash ~/tracking-ui/install-launchd.sh
#
# KHÔNG chứa secret: webhook do Lark Base Automation truyền trong body
#   {instance, webhook}. (Nếu muốn nhúng webhook vào env để body chỉ cần
#   {instance}, set TRACK_WEBHOOK=... trước khi chạy — XEM cuối file.)
# Quản lý:
#   restart:  launchctl kickstart -k gui/$(id -u)/com.approval-tracking.server
#   gỡ:       launchctl bootout  gui/$(id -u) ~/Library/LaunchAgents/com.approval-tracking.server.plist
#   log:      tail -f ~/tracking-ui/server.log
# ───────────────────────────────────────────────────────────────────────────
set -e

NODE="${NODE:-/opt/homebrew/bin/node}"
APP="${APP:-$HOME/tracking-ui}"
PORT="${PORT:-3400}"
TRACK_BASE_URL="${TRACK_BASE_URL:-https://atrack.kntmcptools.online}"
TRACK_WEBHOOK="${TRACK_WEBHOOK:-}"            # tùy chọn: nhúng webhook vào env

LABEL="com.approval-tracking.server"
LA="$HOME/Library/LaunchAgents"
PLIST="$LA/$LABEL.plist"
U="$(id -u)"
mkdir -p "$LA"

[ -x "$NODE" ] || { echo "✗ không thấy node ở $NODE (set NODE=...)"; exit 1; }
[ -f "$APP/server.js" ] || { echo "✗ không thấy $APP/server.js (set APP=...)"; exit 1; }

# Dừng instance nohup đang chiếm port (nếu có) để launchd nắm port
lsof -ti tcp:"$PORT" 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

# Khối env (chỉ thêm TRACK_WEBHOOK nếu được set)
WEBHOOK_ENV=""
[ -n "$TRACK_WEBHOOK" ] && WEBHOOK_ENV="    <key>TRACK_WEBHOOK</key><string>$TRACK_WEBHOOK</string>"

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
    <key>TRACK_BASE_URL</key><string>$TRACK_BASE_URL</string>
$WEBHOOK_ENV
  </dict>
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
echo -n "✓ health: "; curl -s "http://127.0.0.1:$PORT/" | head -c 80; echo
echo "Done."
