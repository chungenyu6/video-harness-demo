"""Harness adapters.

To add a harness: write adapters/<name>.py subclassing HarnessAdapter, call
register() at import time, and add one import line below. Nothing else in the
repo changes — the exporter and the UI both go through base.get().
"""

from .base import HarnessAdapter, get, known, register  # noqa: F401
from . import opencode  # noqa: F401
from . import pi  # noqa: F401
