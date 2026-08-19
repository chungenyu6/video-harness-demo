import { useEffect, useMemo, useState } from "react";
import type { Bundle, HarnessMeta } from "./types";
import type { ScenarioSpec } from "./data";
import type { Scenario } from "./data";
import { groupByVideo, loadBundle, loadBundleIndex, loadHarnesses, loadScenarios, runDuration } from "./data";
import { useClock } from "./clock";
import Video from "./panels/Video";
import Filmstrip from "./panels/Filmstrip";
import Pipeline from "./panels/Pipeline";
import ToolRack from "./panels/ToolRack";
import Budget from "./panels/Budget";
import Steps from "./panels/Steps";
import Verify from "./panels/Verify";
import LiveView from "./LiveView";

type Loaded = Bundle & { _dir: string };

/** Curated order and framing. Grouping by video+question alone cannot express
 *  "these two replicates of the same question are the interesting pair", which
 *  is exactly what the failing runs are. */
function curate(specs: ScenarioSpec[], byName: Map<string, Loaded>): Scenario[] {
  const out: Scenario[] = [];
  for (const spec of specs) {
    const runs = spec.bundles.map((n) => byName.get(n)).filter((b): b is Loaded => Boolean(b));
    if (!runs.length) continue;
    out.push({
      key: spec.id,
      videoId: runs[0].video.id,
      question: runs[0].task.question,
      options: runs[0].task.options,
      runs,
      label: spec.label,
      note: spec.note,
      sampleId: runs[0].sample_id,
    });
  }
  return out;
}

function group(bundles: Loaded[]): Scenario[] {
  const map = new Map<string, Scenario>();
  for (const b of bundles) {
    const key = `${b.video.id}::${b.task.question}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        videoId: b.video.id,
        question: b.task.question,
        options: b.task.options,
        runs: [],
        sampleId: b.sample_id,
      });
    }
    map.get(key)!.runs.push(b);
  }
  return [...map.values()].sort((a, b) => a.videoId.localeCompare(b.videoId));
}

export default function App() {
  const [harnesses, setHarnesses] = useState<HarnessMeta[]>([]);
  const [bundles, setBundles] = useState<Loaded[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [specs, setSpecs] = useState<ScenarioSpec[] | null>(null);
  const [scenarioKey, setScenarioKey] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [selFrame, setSelFrame] = useState<number | null>(null);
  // Live mode exists only when a live server is answering. The static Pages
  // build gets a 404 here and never renders the tab, so the public site cannot
  // offer it even by accident.
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [mode, setMode] = useState<"replay" | "live">("replay");

  useEffect(() => {
    fetch("/api/status")
      .then((r) => setLiveAvailable(r.ok))
      .catch(() => setLiveAvailable(false));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [hs, index, specs] = await Promise.all([
          loadHarnesses(), loadBundleIndex(), loadScenarios(),
        ]);
        setHarnesses(hs);
        setBundles(await Promise.all(index.map(loadBundle)));
        setSpecs(specs);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  const scenarios = useMemo(() => {
    if (!bundles.length) return [];
    if (specs?.length) {
      const byName = new Map(bundles.map((b) => [b._dir, b]));
      const curated = curate(specs, byName);
      if (curated.length) return curated;
    }
    return group(bundles);
  }, [bundles, specs]);
  const videos = useMemo(() => groupByVideo(scenarios), [scenarios]);
  const video = videos.find((v) => v.id === videoId) ?? videos[0] ?? null;
  const scenario =
    video?.scenarios.find((s) => s.key === scenarioKey) ?? video?.scenarios[0] ?? null;

  // Registry order, not bundle order: the columns must not reshuffle between
  // scenarios just because one harness happened to be exported first.
  const columns = useMemo(() => {
    if (!scenario) return [];
    const known = harnesses.length ? harnesses : [];
    const ordered = known
      .map((h) => ({ meta: h, run: scenario.runs.find((r) => r.harness === h.id) }))
      .filter((c): c is { meta: HarnessMeta; run: Loaded } => Boolean(c.run));
    const extras = scenario.runs
      .filter((r) => !known.some((h) => h.id === r.harness))
      .map((run) => ({ meta: { id: run.harness, label: run.harness, color: "#7D6416" }, run }));
    return [...ordered, ...extras];
  }, [scenario, harnesses]);

  const duration = useMemo(
    () => (columns.length ? Math.max(...columns.map((c) => runDuration(c.run))) : 0),
    [columns]
  );
  const clock = useClock(duration);

  const stops = useMemo(() => {
    const s = new Set<number>();
    for (const c of columns) for (const e of c.run.events) s.add(e.t);
    return [...s].sort((a, b) => a - b);
  }, [columns]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.code === "Space") { e.preventDefault(); clock.toggle(); }
      else if (e.code === "ArrowRight") { e.preventDefault(); clock.step(1, stops); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); clock.step(-1, stops); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock, stops]);

  const seekTo = useMemo(() => {
    if (selFrame === null || !columns.length) return null;
    return columns[0].run.frames[selFrame]?.t ?? null;
  }, [selFrame, columns]);

  if (err) return <div className="shell"><div className="error">{err}</div></div>;
  if (!scenario) return <div className="shell"><div className="loading">loading bundles…</div></div>;

  return (
    <>
      <div className="bars" aria-hidden="true">
        <span style={{ background: "#0E7C86" }} />
        <span style={{ background: "#2C6E4B" }} />
        <span style={{ background: "#7D6416" }} />
        <span style={{ background: "#B4611A" }} />
        <span style={{ background: "#A32A20" }} />
        <span style={{ background: "#4E5A5D" }} />
      </div>

      <div className="shell">
        <header className="mast">
          <h1>Two Agents, One Video</h1>
          <p className="sub">
            The same question, the same model, the same tools — and two different coding
            harnesses driving them. Watch what each one actually looked at, what it spent,
            and whether an external checker believes it.
          </p>
        </header>

        {liveAvailable && (
          <div className="tabs" role="group" aria-label="Mode">
            <button aria-pressed={mode === "replay"} onClick={() => setMode("replay")}>
              Recorded runs
            </button>
            <button aria-pressed={mode === "live"} onClick={() => setMode("live")}>
              Ask your own
            </button>
          </div>
        )}

        {mode === "live" ? (
          <LiveView harnesses={harnesses} videos={videos} />
        ) : (
        <>
        <div className="videopick" role="group" aria-label="Choose a video">
          {videos.map((v) => (
            <button
              key={v.id}
              className={`vcard${v.id === video?.id ? " on" : ""}`}
              aria-pressed={v.id === video?.id}
              onClick={() => { setVideoId(v.id); setScenarioKey(null); setSelFrame(null); }}
            >
              {v.thumb && <img src={v.thumb} alt="" loading="lazy" />}
              <span className="vmeta">
                <b>{v.label}</b>
                <span>{Math.round(v.durationSec)}s · {v.scenarios.length} question{v.scenarios.length > 1 ? "s" : ""}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="picker">
          <label>
            <span className="eyebrow">Question</span>
            <select
              value={scenario.key}
              onChange={(e) => { setScenarioKey(e.target.value); setSelFrame(null); }}
            >
              {(video?.scenarios ?? []).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label?.startsWith("Featured")
                    ? `★ ${s.label}`
                    : (s.label?.split(" — ").slice(1).join(" — ") || s.question)}
                </option>
              ))}
            </select>
          </label>
          <div>
            <p className="question">{scenario.question}</p>
            <p className="opts">{scenario.options.join("   ")}</p>
            {scenario.note && <p className="note">{scenario.note}</p>}
          </div>
        </div>

        <div className="transport">
          <button className="primary" onClick={clock.toggle}>
            {clock.playing ? "❚❚ pause" : "▶ play"}
          </button>
          <button onClick={() => clock.step(-1, stops)} aria-label="previous event">◀ step</button>
          <button onClick={() => clock.step(1, stops)} aria-label="next event">step ▶</button>
          <button onClick={clock.restart}>↻ restart</button>
          <span className="clock">
            t+{clock.t.toFixed(1)}s / {duration.toFixed(1)}s
          </span>
          <input
            className="scrub"
            type="range"
            min={0}
            max={duration}
            step={0.05}
            value={clock.t}
            onChange={(e) => clock.seek(Number(e.target.value))}
            aria-label="run position"
          />
          <select
            value={clock.speed}
            onChange={(e) => clock.setSpeed(Number(e.target.value))}
            aria-label="playback speed"
            style={{ minWidth: "4.5rem" }}
          >
            {[0.5, 1, 2, 4].map((s) => (
              <option key={s} value={s}>{s}×</option>
            ))}
          </select>
        </div>

        <div className="stage">
          <Video bundle={columns[0].run} seekTo={seekTo} />

          <div className={`cols n${Math.min(columns.length, 3)}`}>
            {columns.map(({ meta, run }, ci) => (
              <div className="col" key={meta.id}>
                <div className="colhead">
                  <span className="swatch" style={{ background: meta.color }} />
                  <span className="name">{meta.label}</span>
                  <span className="spacer" />
                  <span className="pill p-mute">
                    {(run.telemetry.wall_clock_sec ?? 0).toFixed(0)}s wall
                  </span>
                </div>

                <div className="section-label">Tools</div>
                <ToolRack bundle={run} t={clock.t} />

                <div className="section-label">Procedure</div>
                <Pipeline bundle={run} t={clock.t} />

                <div className="section-label">Frames on the video timeline</div>
                <Filmstrip
                  bundle={run}
                  t={clock.t}
                  selected={ci === 0 ? selFrame : null}
                  onSelect={ci === 0 ? setSelFrame : () => {}}
                />

                <div className="section-label">Perception budget</div>
                <Budget bundle={run} t={clock.t} />

                <div className="section-label">Steps</div>
                <Steps bundle={run} t={clock.t} />

                <div className="section-label">Answer &amp; verification</div>
                <Verify bundle={run} t={clock.t} />
              </div>
            ))}
          </div>
        </div>

        </>
        )}

        <p className="footnote">
          Runs are recorded, then replayed on one shared clock. They were executed
          sequentially, not concurrently — the model servers accept one request at a time,
          so running both at once would distort the timings rather than reveal them.
          <br /><br />
          V0 checks procedure and artifacts only. It does not certify that a frame
          semantically supports its claim, that the evidence justifies the answer, or that
          the model did not hallucinate. Where a scenario has no benchmark answer key,
          correctness is not evaluated at all — only whether the agent did what it says it did.
        </p>
      </div>
    </>
  );
}
