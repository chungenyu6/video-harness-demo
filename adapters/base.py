"""Adapter contract: turn one harness's native event log into normalized events.

An adapter is the ONLY place in this repo that knows what OpenCode or Pi emit.
Everything downstream of `agent_events()` is harness-independent, which is why
adding a third harness costs one file plus a registry entry.

Normalized events carry an absolute epoch-seconds `_ts`; the exporter rebases
them onto a run-relative clock so two bundles can be played side by side.
"""

from __future__ import annotations

import re
from pathlib import Path

# The instrumented scripts. Recognizing which one a bash command invoked is what
# lets the UI draw a pipeline instead of a list of shell strings.
SCRIPTS = ("probe_video", "crv_prepare", "vlm_inspect", "extract_window", "submit_evidence")

_SCRIPT_RE = re.compile(r"tools/(%s)\.py" % "|".join(SCRIPTS))


def recognize_script(command: str | None) -> str | None:
    """Return the instrumented script a bash command ran, or None."""
    if not command:
        return None
    m = _SCRIPT_RE.search(command)
    return m.group(1) if m else None


def ev(ts: float, type_: str, **kw) -> dict:
    """Build one normalized event. `None` values are dropped so bundles stay small."""
    out = {"_ts": float(ts), "type": type_}
    out.update({k: v for k, v in kw.items() if v is not None})
    return out


class HarnessAdapter:
    """Subclasses implement agent_events() and nothing else."""

    name: str = "base"
    #: Files that must exist for this adapter to claim a run directory.
    marker: str = ""

    def claims(self, run_dir: Path) -> bool:
        return bool(self.marker) and bool(list(run_dir.glob(self.marker)))

    def agent_events(self, run_dir: Path) -> list[dict]:
        raise NotImplementedError


_REGISTRY: dict[str, HarnessAdapter] = {}


def register(adapter: HarnessAdapter) -> None:
    _REGISTRY[adapter.name] = adapter


def get(name: str) -> HarnessAdapter:
    if name not in _REGISTRY:
        raise SystemExit(
            f"no adapter for harness {name!r}; known: {sorted(_REGISTRY)}. "
            f"Add adapters/{name}.py and import it in adapters/__init__.py."
        )
    return _REGISTRY[name]


def known() -> list[str]:
    return sorted(_REGISTRY)
