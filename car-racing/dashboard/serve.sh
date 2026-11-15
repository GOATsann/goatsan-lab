#!/bin/bash
# Local dashboard: refresh data.json every 60 s and serve it at http://localhost:8765/dashboard/
cd "$(dirname "$0")/.." || exit 1
(while true; do .venv/bin/python dashboard/export.py >/dev/null 2>&1; sleep 60; done) &
trap 'kill $!' EXIT
echo "Dashboard: http://localhost:8765/dashboard/"
.venv/bin/python -m http.server 8765 --bind 127.0.0.1
