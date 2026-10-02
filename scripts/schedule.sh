#!/bin/bash
# Installs or removes a macOS launchd job that builds the evening brief on
# weekdays at 19:30 local time (after NSE publishes the day's files).
#
#   scripts/schedule.sh install
#   scripts/schedule.sh uninstall
#   scripts/schedule.sh status
#
# launchd runs the job at the next wake if the Mac was asleep at 19:30.
set -euo pipefail

LABEL="com.nse-screener.brief"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"

case "${1:-}" in
  install)
    mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/data/user"
    days=""
    for d in 1 2 3 4 5; do
      days+="<dict><key>Weekday</key><integer>$d</integer><key>Hour</key><integer>19</integer><key>Minute</key><integer>30</integer></dict>"
    done
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$ROOT/scripts/brief.mjs</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>StartCalendarInterval</key><array>$days</array>
  <key>StandardOutPath</key><string>$ROOT/data/user/brief.log</string>
  <key>StandardErrorPath</key><string>$ROOT/data/user/brief.log</string>
</dict>
</plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed. The brief will build on weekdays at 19:30. Log: $ROOT/data/user/brief.log"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed."
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state|last exit|path" || echo "Not installed."
    ;;
  *)
    echo "usage: $0 install|uninstall|status" >&2
    exit 1
    ;;
esac
