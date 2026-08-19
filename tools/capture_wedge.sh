#!/usr/bin/env bash
# Capture what a wedged harness process is actually blocked on.
#
# The OPEN issue in phase 0's decision log says the next step is a stack trace,
# because everything else has been ruled out and any root-cause story without one
# is a guess. This makes that capture automatic instead of depending on someone
# being at the keyboard when it happens.
#
# Works for any process without a language-specific profiler: /proc/<pid>/wchan
# names the kernel function the task is sleeping in, /proc/<pid>/stack is the
# kernel stack, /proc/<pid>/syscall is the syscall and its arguments, and the fd
# and net listings show what it was waiting on.
#
# Usage: bash tools/capture_wedge.sh <out_dir> [pid ...]
#        with no pids, captures every process owned by the agent user.
set -uo pipefail
OUT="${1:?usage: capture_wedge.sh <out_dir> [pid ...]}"; shift
AGENT_USER="${PHASE0_AGENT_USER:-phase0agent}"
mkdir -p "$OUT"

PIDS=("$@")
if [ "${#PIDS[@]}" -eq 0 ]; then
  mapfile -t PIDS < <(pgrep -u "$AGENT_USER" 2>/dev/null)
fi
if [ "${#PIDS[@]}" -eq 0 ]; then
  echo "no processes owned by $AGENT_USER to capture" | tee "$OUT/none.txt"
  exit 0
fi

{
  echo "captured: $(date -Is)"
  echo "agent user: $AGENT_USER"
  echo "pids: ${PIDS[*]}"
} > "$OUT/summary.txt"

for pid in "${PIDS[@]}"; do
  [ -d "/proc/$pid" ] || continue
  f="$OUT/pid-$pid.txt"
  {
    echo "=== cmdline ==="; tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null; echo
    echo "=== state / wchan (what it is sleeping in) ==="
    grep -E '^(Name|State|Threads|VmRSS)' "/proc/$pid/status" 2>/dev/null
    echo "wchan: $(cat "/proc/$pid/wchan" 2>/dev/null)"
    echo "=== syscall (nr + args) ==="; cat "/proc/$pid/syscall" 2>/dev/null
    echo "=== kernel stack ==="; cat "/proc/$pid/stack" 2>/dev/null || echo "(needs CONFIG_STACKTRACE / privileges)"
    echo "=== open fds (resolved) ==="
    # readlink rather than `ls -l`: reading another user's /proc/<pid>/fd with ls
    # prints the entries but drops the "-> target" half, which is the only part
    # that matters - a socket to 127.0.0.1:8001 means the request went out.
    for fd in "/proc/$pid/fd"/*; do
      # -L, not -e: these entries are symlinks to things like "socket:[12345]",
      # which is not a real path, so -e follows the link, finds nothing, and
      # skips every single fd. That silently emptied the most useful section of
      # this report the first time it mattered.
      [ -L "$fd" ] || continue
      printf '  %-4s -> %s\n' "$(basename "$fd")" "$(readlink "$fd" 2>/dev/null || echo '?')"
    done | head -50
    echo "=== sockets held (inode -> endpoint) ==="
    inodes=$(for fd in "/proc/$pid/fd"/*; do [ -L "$fd" ] && readlink "$fd"; done 2>/dev/null \
             | sed -n 's/^socket:\[\([0-9]*\)\]$/\1/p')
    if [ -n "$inodes" ]; then
      python3 - "$inodes" <<'PY' 2>/dev/null || echo "  (could not decode)"
import socket, struct, sys
want = set(sys.argv[1].split())
for path in ("/proc/net/tcp", "/proc/net/tcp6"):
    try: lines = open(path).read().splitlines()[1:]
    except OSError: continue
    for ln in lines:
        f = ln.split()
        if f[9] not in want: continue
        def addr(x):
            ip, port = x.split(":")
            if len(ip) == 8:
                ip = socket.inet_ntoa(struct.pack("<I", int(ip, 16)))
            else:
                ip = "[v6]"
            return f"{ip}:{int(port,16)}"
        print(f"  inode {f[9]}: {addr(f[1])} -> {addr(f[2])}  state={f[3]}")
PY
    else
      echo "  none"
    fi
    echo "=== per-thread wchan ==="
    for t in "/proc/$pid/task"/*; do
      [ -d "$t" ] || continue
      printf '  tid %s  %s  wchan=%s\n' "$(basename "$t")" \
        "$(awk '/^State/{print $2}' "$t/status" 2>/dev/null)" \
        "$(cat "$t/wchan" 2>/dev/null)"
    done
  } > "$f" 2>&1
  echo "  captured pid $pid -> $f"
done

# What the process might be waiting on, recorded alongside.
{
  echo "=== model endpoints ==="
  for p in 8001 8002; do
    printf 'port %s: ' "$p"
    curl -s -m 5 -o /dev/null -w '%{http_code} in %{time_total}s\n' \
      "http://127.0.0.1:$p/v1/models" || echo "unreachable"
  done
  echo "=== vllm queue ==="
  curl -s -m 5 http://127.0.0.1:8001/metrics 2>/dev/null \
    | grep -E 'num_requests_(running|waiting)' | grep -v '^#'
  echo "=== load / memory ==="; uptime; free -m | head -2
} > "$OUT/environment.txt" 2>&1

echo "wedge capture written to $OUT"
