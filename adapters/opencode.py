"""OpenCode adapter.

Source: `agent/opencode-events.jsonl`, one JSON object per line.

Native shape (verified against rep_103):
  step_start   -> a controller turn begins
  text         -> assistant prose, in part.text
  tool_use     -> ONE event carrying both call and result, with real execution
                  timing in part.state.time.{start,end} and the shell exit code
                  in part.state.metadata.exit
  step_finish  -> token usage for the turn

Two quirks worth knowing:
  * The envelope `timestamp` is when the event was flushed, not when the tool
    ran. Use state.time.* so the clock matches what actually happened.
  * A model call to a tool that is not in the allowed set arrives as
    tool == "invalid", with the attempted name inside state.input. That is a
    real behavioural signal, not noise, so it becomes tool.error rather than
    being dropped.
"""

from __future__ import annotations

import json
from pathlib import Path

from .base import HarnessAdapter, ev, recognize_script, register


class OpenCodeAdapter(HarnessAdapter):
    name = "opencode"
    marker = "agent/opencode-events.jsonl"

    def agent_events(self, run_dir: Path) -> list[dict]:
        path = run_dir / "agent" / "opencode-events.jsonl"
        if not path.exists():
            raise SystemExit(f"opencode event log missing: {path}")

        out: list[dict] = []
        for line in path.read_text(errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue

            kind = e.get("type")
            part = e.get("part") or {}
            envelope_ts = (e.get("timestamp") or 0) / 1000.0

            if kind == "step_start":
                out.append(ev(envelope_ts, "step.begin"))

            elif kind == "text":
                text = (part.get("text") or "").strip()
                if text:
                    out.append(ev(envelope_ts, "agent.say", text=text))

            elif kind == "tool_use":
                state = part.get("state") or {}
                tool = part.get("tool")
                args = state.get("input") or {}
                time = state.get("time") or {}
                t_start = (time.get("start") or e.get("timestamp") or 0) / 1000.0
                t_end = (time.get("end") or e.get("timestamp") or 0) / 1000.0
                meta = state.get("metadata") or {}

                if tool == "invalid":
                    # The model reached for a tool it does not have.
                    out.append(ev(
                        t_start, "tool.error",
                        tool=args.get("tool") or "invalid",
                        detail=args.get("error") or "unavailable tool",
                    ))
                    continue

                command = args.get("command") if isinstance(args, dict) else None
                script = recognize_script(command)
                out.append(ev(t_start, "tool.call", tool=tool, script=script, args=args))

                exit_code = meta.get("exit")
                ok = state.get("status") == "completed" and (exit_code in (None, 0))
                out.append(ev(
                    t_end, "tool.result",
                    tool=tool, script=script, ok=ok,
                    detail=_truncate(state.get("output")),
                    elapsed_sec=round(max(0.0, t_end - t_start), 3),
                ))

        out.sort(key=lambda x: x["_ts"])
        return out


def _truncate(text: str | None, limit: int = 1400) -> str | None:
    if not text:
        return None
    text = text.strip()
    return text if len(text) <= limit else text[:limit] + f"\n… (+{len(text) - limit} chars)"


register(OpenCodeAdapter())
