// Live mode UI - only rendered when /api/status answers, which it does not on the
// static Pages build. The public site cannot offer this tab even by mistake.
//
// Uses the same video picker as the replay tab. The first version listed videos
// by raw id in a dropdown ("Kv1JXuOkAfk (42s)"), which is unusable: you cannot
// pick a video you cannot recognise. Sharing the picker also means new content
// shows up in both tabs from the same source.

import { useEffect, useMemo, useState } from "react";
import { useLive } from "./live";
import { useClock } from "./clock";
import type { HarnessMeta } from "./types";
import type { VideoGroup } from "./data";
import { suggestionsFor } from "./data";
import Video from "./panels/Video";
import Filmstrip from "./panels/Filmstrip";
import Pipeline from "./panels/Pipeline";
import ToolRack from "./panels/ToolRack";
import Budget from "./panels/Budget";
import Steps from "./panels/Steps";
import Verify from "./panels/Verify";

interface Props {
  harnesses: HarnessMeta[];
  videos: VideoGroup[];
}

interface Health {
  ok: boolean;
  services: { name: string; up: boolean; model: string | null; start_with: string }[];
}

export default function LiveView({ harnesses, videos }: Props) {
  const live = useLive();
  const [harness, setHarness] = useState(harnesses[0]?.id ?? "opencode");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  //: set when the question came from a suggestion, so the server can reuse the
  //  original answer options instead of the generic yes/no set.
  const [sampleRef, setSampleRef] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  // Checked on load and after every run, because the usual way this breaks is
  // that the GPU servers were never started - and without this the only symptom
  // is a run that hangs and times out minutes later.
  useEffect(() => {
    let alive = true;
    const poll = () =>
      fetch("/api/health")
        .then((r) => r.json())
        .then((h: Health) => { if (alive) setHealth(h); })
        .catch(() => { if (alive) setHealth(null); });
    poll();
    const id = setInterval(poll, 20000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const video = videos.find((v) => v.id === videoId) ?? videos[0] ?? null;
  const suggestions = useMemo(() => (video ? suggestionsFor(video) : []), [video]);

  const duration = live.bundle?.events.length
    ? live.bundle.events[live.bundle.events.length - 1].t
    : 0;
  const clock = useClock(duration);
  const t = live.status === "finished" ? clock.t : live.t;

  // Land on the END of the run when it finishes.
  //
  // Swapping in the finished bundle changes `duration`, and useClock resets to 0
  // on a duration change - so the moment a live run completed the panel jumped
  // back to t=0 and showed no answer and no verification, which reads as the
  // checker having produced nothing. Seek to the end so the result is what you
  // see; the transport is right there to replay from the start.
  useEffect(() => {
    if (live.status === "finished" && duration > 0) clock.seek(duration);
    // clock.seek is stable; depending on it would re-fire on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.status, duration]);

  const stops = useMemo(
    () => (live.bundle ? [...new Set(live.bundle.events.map((e) => e.t))].sort((a, b) => a - b) : []),
    [live.bundle]
  );

  const meta = harnesses.find((h) => h.id === harness);
  const busy = live.status === "starting" || live.status === "running";
  const modelsUp = health?.ok ?? true;
  const canRun = !busy && modelsUp && Boolean(video) && question.trim().length >= 8;

  const run = () => {
    if (!video || !canRun) return;
    live.start(harness, video.id, question, sampleRef ?? undefined);
  };

  return (
    <>
      <div className="videopick" role="group" aria-label="Choose a video">
        {videos.map((v) => (
          <button
            key={v.id}
            className={`vcard${v.id === video?.id ? " on" : ""}`}
            aria-pressed={v.id === video?.id}
            disabled={busy}
            onClick={() => { setVideoId(v.id); setQuestion(""); setSampleRef(null); }}
          >
            {v.thumb && <img src={v.thumb} alt="" loading="lazy" />}
            <span className="vmeta">
              <b>{v.label}</b>
              <span>{Math.round(v.durationSec)}s</span>
            </span>
          </button>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div className="suggest">
          <span className="eyebrow">Try one of these</span>
          <div className="chips">
            {suggestions.map((s) => (
              <button
                key={s.question}
                className={`chip${question === s.question ? " on" : ""}`}
                disabled={busy}
                onClick={() => { setQuestion(s.question); setSampleRef(s.sampleId ?? null); }}
                title={s.sampleId ? `runs with this item's original answer options` : undefined}
              >
                {s.question}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="picker">
        <label>
          <span className="eyebrow">Harness</span>
          <select value={harness} onChange={(e) => setHarness(e.target.value)} disabled={busy}>
            {harnesses.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
        </label>
        <label style={{ flex: 1, minWidth: "20rem" }}>
          <span className="eyebrow">Or ask your own</span>
          <input
            className="qinput"
            value={question}
            onChange={(e) => { setQuestion(e.target.value); setSampleRef(null); }}
            placeholder="What colour is the car in this video?"
            maxLength={240}
            disabled={busy}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          />
        </label>
        <button className="go" disabled={!canRun} onClick={run}>
          {busy ? "running…" : "run it"}
        </button>
        {live.status === "finished" && <button onClick={live.reset}>new question</button>}
      </div>

      {health && !health.ok && (
        <div className="warnbox">
          <b>The model servers are not running, so a run cannot start.</b>
          <ul>
            {health.services.filter((sv) => !sv.up).map((sv) => (
              <li key={sv.name}>
                <code>{sv.name}</code> is down — start it with <code>{sv.start_with}</code>{" "}
                in the phase-0 repo
              </li>
            ))}
          </ul>
          <span className="hint">Rechecked every 20 seconds; this clears itself once they are up.</span>
        </div>
      )}

      {health?.ok && (
        <p className="okline">
          models up: {health.services.map((sv) => sv.model ?? sv.name).join(" · ")}
        </p>
      )}

      {live.error && <div className="error">{live.error}</div>}

      <p className="livenote">
        {sampleRef
          ? "This is a benchmark item, so it runs with its original answer options and does have a key — though nothing here is scored against it."
          : "There is no answer key for a question you wrote, so nothing here can tell you whether the answer is right."}{" "}
        What it can tell you is whether the agent actually looked: how many frames it spent,
        whether the frames it cites exist, and whether the windows it claims to have examined
        are physically possible. That is the point — procedure is verifiable without an answer key.
      </p>

      {live.bundle && (
        <>
          {live.status === "finished" && (
            <div className="transport">
              <button className="primary" onClick={clock.toggle}>
                {clock.playing ? "❚❚ pause" : "▶ replay"}
              </button>
              <button onClick={() => clock.step(-1, stops)}>◀ step</button>
              <button onClick={() => clock.step(1, stops)}>step ▶</button>
              <span className="clock">t+{t.toFixed(1)}s / {duration.toFixed(1)}s</span>
              <input
                className="scrub" type="range" min={0} max={duration} step={0.05}
                value={clock.t} onChange={(e) => clock.seek(Number(e.target.value))}
                aria-label="run position"
              />
            </div>
          )}

          <div className="stage">
            {live.bundle._dir && <Video bundle={live.bundle} seekTo={null} />}
            <div className="cols n1">
              <div className="col">
                <div className="colhead">
                  <span className="swatch" style={{ background: meta?.color ?? "#7D6416" }} />
                  <span className="name">{meta?.label ?? harness}</span>
                  <span className="spacer" />
                  <span className={`pill ${live.status === "finished" ? "p-pass" : "p-warm"}`}>
                    {live.status}
                  </span>
                </div>
                <div className="section-label">Tools</div>
                <ToolRack bundle={live.bundle} t={t} />
                <div className="section-label">Procedure</div>
                <Pipeline bundle={live.bundle} t={t} />
                {live.bundle.frames.length > 0 && (
                  <>
                    <div className="section-label">Frames on the video timeline</div>
                    <Filmstrip bundle={live.bundle} t={t} selected={null} onSelect={() => {}} />
                  </>
                )}
                <div className="section-label">Perception budget</div>
                <Budget bundle={live.bundle} t={t} />
                <div className="section-label">Steps</div>
                <Steps bundle={live.bundle} t={t} />
                <div className="section-label">Answer &amp; verification</div>
                <Verify bundle={live.bundle} t={t} />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
