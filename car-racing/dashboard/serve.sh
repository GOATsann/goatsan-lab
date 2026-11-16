#!/bin/bash
# Local dashboard for every goatsan-lab project. Refreshes the data every 60 s and serves the whole lab
# folder (the runner's videos live outside car-racing/): http://localhost:8765/car-racing/dashboard/
LAB="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$LAB" || exit 1
PY="$LAB/car-racing/.venv/bin/python"
(while true; do
  "$PY" car-racing/dashboard/export.py >/dev/null 2>&1
  "$PY" car-racing/dashboard/export_runner.py >/dev/null 2>&1
  sleep 60
done) &
trap 'kill $!' EXIT
echo "Dashboard: http://localhost:8765/car-racing/dashboard/  (runner: ?p=runner)"
"$PY" -m http.server 8765 --bind 127.0.0.1
