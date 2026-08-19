#!/usr/bin/env bash
# Start live mode.
#
#   bash scripts.live.sh                    -> 127.0.0.1:8080  (default, safest)
#   LIVE_HOST=0.0.0.0 bash scripts.live.sh  -> reachable from the Docker host,
#                                              which is what `ssh -L` needs
#
# See the security note in live/app.py before widening the bind.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HOST="${LIVE_HOST:-127.0.0.1}"
PORT="${LIVE_PORT:-8080}"
PY=/home/video-code-harness/video-agent-harness-phase0/.venv/bin/python

if [ "$HOST" != "127.0.0.1" ]; then
  echo "NOTE: binding $HOST - the service that can start agent runs is now"
  echo "      reachable beyond loopback. Intended for an SSH tunnel from the host."
fi
exec "$PY" -m uvicorn live.app:api --host "$HOST" --port "$PORT"
