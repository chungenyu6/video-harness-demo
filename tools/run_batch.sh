#!/usr/bin/env bash
# Run the demo content on every harness, sequentially.
#
# Sequential is not a simplification: both model servers run with
# --max-num-seqs 1 and share GPUs 0-3, so two runs at once would queue inside
# vLLM and corrupt the per-run timings the demo displays.
#
# Fails fast on a timeout. A healthy run of this content takes 30-90 s; a run
# that hits the ceiling means the harness is wedged, and continuing would burn
# an hour discovering that thirty more times. Seen once in practice: both
# harnesses hung at session creation until stale phase0agent processes were
# cleared, so the batch now clears them first and stops if it happens again.
#
# Usage: bash tools/run_batch.sh [sample_id ...]
set -uo pipefail
DEMO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."; pwd)"
PHASE0=/home/video-code-harness/video-agent-harness-phase0
TASKS="$DEMO/content/demo_tasks.jsonl"

cd "$PHASE0"
source scripts/env.sh
export PHASE0_TASKS_FILE="$TASKS"
export PHASE0_RUN_TIMEOUT="${PHASE0_RUN_TIMEOUT:-150}"
REP="${PHASE0_REPLICATE:-900}"

# A wedged agent from a previous batch will wedge this one too.
pkill -u phase0agent 2>/dev/null; sleep 1

if [ "$#" -gt 0 ]; then
  SAMPLES=("$@")
else
  mapfile -t SAMPLES < <(python3 -c "
import json
for line in open('$TASKS'):
    line = line.strip()
    if line:
        print(json.loads(line)['sample_id'])
")
fi

ok=0; fail=0
for sid in "${SAMPLES[@]}"; do
  for h in opencode pi; do
    start=$(date +%s)
    # Watchdog: a healthy run of this content finishes in 30-90 s. If one is still
    # alive well past that, capture its state while it is STILL RUNNING - once the
    # timeout fires the process is gone and with it the only evidence.
    wedge_dir="$DEMO/live/logs/wedge-$(date +%s)-$sid-$h"
    ( sleep "$(( PHASE0_RUN_TIMEOUT - 20 ))"
      pgrep -u "${PHASE0_AGENT_USER:-phase0agent}" >/dev/null 2>&1 &&
        bash "$DEMO/tools/capture_wedge.sh" "$wedge_dir" >/dev/null 2>&1
    ) & watchdog=$!
    out="$(bash "scripts/run_${h}.sh" "$sid" "$REP" 2>&1)"
    code=$?
    kill "$watchdog" 2>/dev/null; wait "$watchdog" 2>/dev/null
    elapsed=$(( $(date +%s) - start ))
    status="$(printf '%s' "$out" | python3 -c "
import json,sys
raw = sys.stdin.read()
i = raw.rfind('{')
try:
    d = json.loads(raw[i:])
    print(f\"v0={d.get('v0_status')} answer={d.get('answer')} exit={d.get('exit_code')}\")
except Exception:
    print('(no result json)')
" 2>/dev/null)"
    printf '%-9s %-9s %4ds  %s\n' "$sid" "$h" "$elapsed" "$status"

    if printf '%s' "$out" | grep -q 'exit_code": 124' || [ "$elapsed" -ge "$PHASE0_RUN_TIMEOUT" ]; then
      echo "ABORT: $sid/$h hit the ${PHASE0_RUN_TIMEOUT}s ceiling - the harness is wedged."
      # The timeout has already killed the agent by now, so this usually finds
      # nothing. It is still worth attempting: on the runs where a child survives
      # the kill, /proc/<pid>/wchan names the syscall it is stuck in, which is the
      # one piece of evidence the OPEN issue is missing.
      bash "$DEMO/tools/capture_wedge.sh" "$DEMO/live/logs/wedge-$(date +%s)-$sid-$h" || true
      echo "       Clear stale agents (pkill -u phase0agent) and re-run."
      exit 1
    fi
    if [ "$code" -eq 0 ]; then ok=$((ok+1)); else fail=$((fail+1)); fi
  done
done
echo
echo "runs ok=$ok fail=$fail"
