"""Pi adapter.

Source: `agent/pi-sessions/*.jsonl` — NOT `agent/pi-events.jsonl`.

That choice matters and is easy to get wrong. `pi-events.jsonl` is the larger,
more detailed stream (1178 lines for rep_103 against 24), but it carries no
timestamps at all: every entry has the session's start time or nothing. The
session log carries a real epoch-ms timestamp on every message, which is what a
synchronized side-by-side replay needs. Detail we can reconstruct; time we cannot.

Native shape (verified against rep_103):
  message role=assistant  -> content[] holds text parts and toolCall parts
                             {id, name, arguments}, plus usage tokens
  message role=toolResult -> {toolCallId, toolName, content[], isError}
  message role=user       -> the task prompt
  session / session_info / model_change / thinking_level_change -> run metadata

Pi has no explicit turn event in this log, so each assistant message is treated
as the start of a controller step. That matches what `turn_start` marks in the
event stream, checked against rep_103: 10 assistant messages, 10 turns.
"""

from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path

from .base import HarnessAdapter, ev, recognize_script, register


def _iso_to_epoch(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return _dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


class PiAdapter(HarnessAdapter):
    name = "pi"
    marker = "agent/pi-sessions/*.jsonl"

    def agent_events(self, run_dir: Path) -> list[dict]:
        files = sorted((run_dir / "agent" / "pi-sessions").glob("*.jsonl"))
        if not files:
            raise SystemExit(f"pi session log missing under {run_dir / 'agent' / 'pi-sessions'}")

        rows: list[dict] = []
        for f in files:
            for line in f.read_text(errors="replace").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

        # Remember what each tool call was, so its result can be labelled with the
        # same script without re-parsing the command.
        call_script: dict[str, str | None] = {}
        call_tool: dict[str, str] = {}
        out: list[dict] = []

        for r in rows:
            ts = _iso_to_epoch(r.get("timestamp"))
            msg = r.get("message") or {}
            role = msg.get("role")
            if ts is None:
                inner = msg.get("timestamp")
                ts = inner / 1000.0 if isinstance(inner, (int, float)) else None
            if ts is None:
                continue

            if r.get("type") != "message":
                continue

            if role == "assistant":
                out.append(ev(ts, "step.begin"))
                for c in msg.get("content") or []:
                    if not isinstance(c, dict):
                        continue
                    if c.get("type") == "text":
                        text = (c.get("text") or "").strip()
                        if text:
                            out.append(ev(ts, "agent.say", text=text))
                    elif c.get("type") == "toolCall":
                        args = c.get("arguments") or {}
                        command = args.get("command") if isinstance(args, dict) else None
                        script = recognize_script(command)
                        cid = c.get("id") or ""
                        call_script[cid] = script
                        call_tool[cid] = c.get("name") or "?"
                        out.append(ev(
                            ts, "tool.call",
                            tool=c.get("name"), script=script, args=args,
                        ))

            elif role == "toolResult":
                cid = msg.get("toolCallId") or ""
                text = "".join(
                    c.get("text") or ""
                    for c in (msg.get("content") or [])
                    if isinstance(c, dict) and c.get("type") == "text"
                )
                is_error = bool(msg.get("isError"))
                tool = msg.get("toolName") or call_tool.get(cid) or "?"
                script = call_script.get(cid)
                if is_error:
                    out.append(ev(ts, "tool.error", tool=tool, script=script,
                                  detail=_truncate(text)))
                out.append(ev(ts, "tool.result", tool=tool, script=script,
                              ok=not is_error, detail=_truncate(text)))

        out.sort(key=lambda x: x["_ts"])
        return out


def _truncate(text: str | None, limit: int = 1400) -> str | None:
    if not text:
        return None
    text = text.strip()
    return text if len(text) <= limit else text[:limit] + f"\n… (+{len(text) - limit} chars)"


register(PiAdapter())
