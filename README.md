# Two Agents, One Video

**Live site: https://chungenyu6.github.io/video-harness-demo/**

> Deployed by `.github/workflows/deploy.yml` on every push to `main`. If the link
> 404s, Pages has not been switched on yet: repository **Settings → Pages →
> Source → GitHub Actions**, then re-run the latest workflow. That setting is not
> something the workflow can set for itself.

A replay viewer for a **verifiable video-QA harness**. It shows two coding
harnesses — [OpenCode](https://opencode.ai) and Pi — answering the same question
about the same video, driven by the same model with the same tools, and it shows
what each one *actually looked at* before answering.

The interesting claim here is not "the agent answered correctly". It is
**"the agent actually looked, and we can prove it."** Three things carry that
claim, and the UI is built around them:

| | |
|---|---|
| **Perception is metered** | Frames are a budget: 16 coarse, 16 dense, 32 total to the vision model. You watch it deplete. |
| **Evidence is anchored in time** | Every claim cites a frame at a timestamp. Citations land on the video's own timeline. |
| **Procedure is checked externally** | An independent checker recomputes what the agent did from tool logs it cannot write to. |

For one 42-second clip, the agent answered having seen **8 of 1,266 frames —
0.63% of the video**. The viewer has a toggle that collapses the clip to exactly
those 8 stills, so that gap is something you watch rather than something you are told.

## What you are looking at

- **Tools** — every tool the agent could call, dimmed until used. An idle tool is
  as informative as a busy one.
- **Procedure** — the declared pipeline with the actual path traced over it.
  A dashed, faded `extract_window` means coarse sampling settled the question.
  A red dashed node means the agent *claimed* a step the tool logs do not support.
- **Frames on the video timeline** — extracted frames at their real timestamps.
  Outlined means the vision model saw it; ringed means the agent cited it.
- **Perception budget** — three gauges depleting live. A refused reservation is a
  hard limit visibly biting.
- **Steps** — the normalized trace, errors and retries inline, raw payload one click away.
- **Answer & verification** — the answer, its cited evidence, and the checker's verdict.

## Featured cases

Runs that *fail* verification are worth more than runs that pass, because they
show the checker doing something. Two are included:

- **A window past the end of the video.** One agent reported examining `[0, 101.6]`
  and `[38, 48]` of a 42.2-second clip and listed `extract_window` in its trace. It
  never ran `extract_window`; it delegated evidence-writing to a subagent that
  invented the trace. **The answer was still correct.**
- **The opposite error.** Another really did run a dense pass, spending 16 inspected
  frames, then reported 8 — and pointed `extract_window` at its own coarse output
  directory, overwriting it.

An agent can be right and dishonest, or honest and under-reporting. Only a checker
with independent access to the ledger tells them apart.

## Operating it

Day-to-day instructions (SSH, starting and stopping, loading the models onto the
GPUs, cleanup, and what to do when something is stuck) are in
[`docs/OPERATING.zh-TW.md`](docs/OPERATING.zh-TW.md).

## Reaching live mode

```bash
bash scripts.live.sh                      # 127.0.0.1:8080 - the default
LIVE_HOST=0.0.0.0 bash scripts.live.sh    # also reachable from the Docker host
```

The default bind is loopback, which works when the port forwarder runs in the
same place as the server — VS Code Dev Containers runs its server inside the
container and can reach it.

It is **not** enough for `ssh -L 8080:<container-ip>:8080` from the host: nothing
is listening on that interface, so the tunnel opens onto nothing. That route
needs `LIVE_HOST=0.0.0.0`, which inside a container with no published ports
exposes the service to the Docker bridge — the host and sibling containers — and
not to the internet. It is a real widening of a service that can start agent
runs, so it is opt-in. Do not combine it with `docker run -p`.

The static viewer has no such constraint and binds all interfaces already: it
only hands out files.

## Live mode output

A live run produces a full run directory (~20 MB, mostly a copy of the source
video) plus a bundle. **Only the current one is kept**: each run clears the
previous one before it starts, so the finished run stays available while you are
looking at it and disappears when you ask the next question. Bundle and run
directory go together, because a bundle whose run directory is gone can no longer
be re-verified. `tools/prune_live.py` remains for manual cleanup.

Live bundles are gitignored and skipped by `tools/make_scenarios.py`, so a
question someone typed can never reach the published site.

## What this does *not* show

The checker validates **procedure and artifacts only**. It does not certify that a
frame semantically supports its claim, that the evidence justifies the answer, or
that the model did not hallucinate.

Most scenarios here have no answer key at all. That is deliberate: **procedure can
be verified without one.** We cannot tell you whether an answer is right, but we can
tell you whether the agent probed the video, how many frames it spent, whether the
frames it cited exist, and whether the windows it claims to have examined are
physically possible.

## Running locally

```bash
source scripts.env.sh          # node >= 20.5 is required; the host default is v16
cd app && npm install
npm run dev                    # http://localhost:5173
```

The dev server listens on `0.0.0.0`. Vite's default (`localhost`) resolves to
`::1` on some hosts and binds IPv6 only, so a forwarded port connects over IPv4,
receives nothing, and the browser shows a blank page while the terminal happily
reports "ready". Binding all interfaces also covers running inside a container,
where the connection may arrive on the container IP rather than on loopback.

The live server in `live/` deliberately does the opposite and stays on
`127.0.0.1`: it can start agent runs, so reachability is not something to be
generous with.

## Repository layout

```
schema/bundle.schema.json   the contract between harness and UI
adapters/                   one file per harness; the only harness-aware code
tools/export_run.py         allowlist exporter: run directory -> replay bundle
tools/validate_bundle.py    schema + leak + sanity gate
bundles/                    committed replay data
app/                        Vite + React viewer
content/demo_tasks.jsonl    the questions used for the demo runs
```

### Adding content

Nothing here requires touching application code. To add a question:

```bash
# 1. one line in the task file
echo '{"sample_id":"185-d3","video_path":"data/working/videos/mmKggCnGtA4.mp4",
        "question":"Is the dance floor crowded, or only a few people?",
        "options":["A. Crowded.","B. Only two.","C. Empty.","D. Cannot tell."],
        "duration":"short","role":"demo"}' >> content/demo_tasks.jsonl

# 2. run it on every harness, sequentially
bash tools/run_batch.sh 185-d3

# 3. turn the runs into replay bundles
python tools/export_run.py --out bundles --run-dir <run_dir>...

# 4. regenerate the picker
python tools/make_scenarios.py
```

A new **video** needs two extra steps before that: put the file where the harness
expects it, and `bash tools/make_proxies.sh` to produce the 480p copy the viewer
plays. Optionally add a readable name to `content/video_labels.json`; without one
the video id is used.

`tools/make_scenarios.py` derives the whole picker from the bundles that exist.
The two things it cannot derive live beside it and are preserved verbatim:
`content/featured.json` (which pairing makes an argument is an editorial call)
and `content/video_labels.json`. Run it with `--check` in CI to catch a stale
file.

### Adding a harness

1. Write `adapters/<name>.py` mapping six events (`step.begin`, `agent.say`,
   `tool.call`, `tool.result`, `tool.error`, plus run metadata).
2. Add an entry to `app/public/harnesses.json`.

There is no step 3. Everything downstream of the tools is already
harness-independent, because every harness runs the same instrumented scripts.
The viewer renders *N* columns; two is just the current value of *N*.

## Provenance and limits

Runs were executed **sequentially, not concurrently**. Both model servers run with
`--max-num-seqs 1` on shared GPUs, so running two harnesses at once would queue
inside the server and corrupt the timings rather than reveal them. The side-by-side
view is a synchronized replay on one normalized clock.

A single run is one sample. Do not read harness differences off one pairing.

Videos are 480p, audio-stripped excerpts from
[Video-MME](https://huggingface.co/datasets/lmms-eval/Video-MME), used here to
illustrate research. Frames are shipped unmodified, because they are the evidence.

## Licence

MIT. See `LICENSE`.
