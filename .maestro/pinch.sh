#!/bin/bash
# Runs alongside .maestro/pinch.yaml: once that flow has written in a note, does real pinches and
# two-finger scrolls, taking a picture after each. The app's zoom log comes back as out/quill-gesture.log.
SIM="$1"
xcrun swiftc .maestro/sim-pinch.swift -o /tmp/sim-pinch || { echo "couldn't build"; exit 1; }
LOG() { echo "$(xcrun simctl get_app_container "$SIM" com.solyapps.notes data)/Documents/quill-gesture.log"; }
for i in $(seq 1 240); do
  n=$(grep -c "stroke end" "$(LOG)" 2>/dev/null || echo 0)
  [ "${n:-0}" -ge 3 ] && break
  sleep 2
done
echo "strokes seen: $n"
osascript -e 'tell application "Simulator" to activate'
sleep 2
step=0
shot() { step=$((step+1)); xcrun simctl io "$SIM" screenshot "shots/p$(printf %02d $step)-$1.png" >/dev/null 2>&1; }
shot start
for r in 1 2 3; do
  /tmp/sim-pinch pinch 60 240; sleep 0.25; shot in$r
  /tmp/sim-pinch pan 0 -220; sleep 0.25; shot pan$r
  /tmp/sim-pinch pinch 240 110; sleep 0.25; shot out$r
  sleep 1.2; shot rest$r
done
# Fast one straight after another: fingers back down before the last zoom has settled.
for r in 1 2 3 4; do /tmp/sim-pinch pinch 60 200; /tmp/sim-pinch pinch 200 60; done
sleep 1.5; shot end
cp "$(LOG)" out/quill-gesture.log
touch out/pinch-done
echo finished
