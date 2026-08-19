"""Question sanitising for live mode.

Threat model, stated plainly: the visitor's text is written into
`input/task.json` and `input/question.txt`, which the agent reads with its own
tools, and that agent has a real shell. So this text reaches a place where it can
try to act as an instruction.

This module is defence in depth, NOT the boundary. The boundary is D007 - the
agent runs as an unprivileged user that cannot read the gold labels, cannot write
anywhere in the repo, and (after L0) has no egress. A regex has never stopped a
determined prompt injection and this one will not either. What it does buy:

  * it stops the accidental and the low-effort;
  * it keeps the question short enough to be read by a human in the log;
  * every submission is recorded, so an attempt is visible after the fact.

Live mode is bound to 127.0.0.1 and reached over SSH, so the population that can
send anything here is one person. That is the real mitigation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

MAX_LEN = 240
MIN_LEN = 8

#: Substrings that have no business in a question about a video. Deliberately
#: blunt: a false positive costs a rephrase, a false negative costs a shell.
BLOCKED = [
    (re.compile(r"[;&|`$]|\$\(|\{\{"), "shell metacharacters"),
    (re.compile(r"\.\./|/etc/|/root/|/home/|~/"), "filesystem paths"),
    (re.compile(r"\b(sudo|chmod|chown|curl|wget|ssh|nc|bash|sh|python|rm)\b", re.I),
     "command names"),
    (re.compile(r"\b(ignore|disregard|forget)\b.{0,30}\b(instruction|prompt|above|previous|rule)s?\b", re.I),
     "instruction-override phrasing"),
    (re.compile(r"\b(system prompt|you are now|new instructions?|act as)\b", re.I),
     "role-override phrasing"),
    (re.compile(r"gold|answer key|label file|phase0_gold|data/labels", re.I),
     "references to the answer key"),
    (re.compile(r"<\s*/?\s*(script|iframe|img|svg)", re.I), "markup"),
]

_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


@dataclass
class Result:
    ok: bool
    question: str = ""
    reason: str = ""


def sanitize(raw: str) -> Result:
    text = _CONTROL.sub("", (raw or "")).strip()
    text = re.sub(r"\s+", " ", text)

    if len(text) < MIN_LEN:
        return Result(False, reason=f"too short (minimum {MIN_LEN} characters)")
    if len(text) > MAX_LEN:
        return Result(False, reason=f"too long ({len(text)} characters, maximum {MAX_LEN})")
    if not text.endswith("?"):
        # Not security - it keeps the field being used as a question rather than
        # as a general-purpose prompt, which is a surprisingly effective narrowing.
        return Result(False, reason="must be phrased as a question and end with '?'")

    for pattern, label in BLOCKED:
        if pattern.search(text):
            return Result(False, reason=f"contains {label}")

    return Result(True, question=text)


def default_options() -> list[str]:
    """Live questions are open-ended, but the harness contract expects options.

    Offering an explicit 'cannot be determined' is not padding: without it the
    agent must pick one of three substantive answers even when the frames do not
    support any, which manufactures a confident wrong answer.
    """
    return [
        "A. Yes.",
        "B. No.",
        "C. Partly, or only at some points in the video.",
        "D. Cannot be determined from the video.",
    ]
