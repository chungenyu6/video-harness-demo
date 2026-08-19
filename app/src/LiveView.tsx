// Live mode UI - only ever rendered when /api/status answers, which it does not
// on the static Pages build. The public site cannot offer this tab even by mistake.

import { useEffect, useMemo, useState } from "react";
import { useLive } from "./live";
import { useClock } from "./clock";
import type { HarnessMeta } from "./types";
import Video from "./panels/Video";
import Filmstrip from "./panels/Filmstrip";
import Pipeline from "./panels/Pipeline";
import ToolRack from "./panels/ToolRack";
import Budget from "./panels/Budget";
import Steps from "./panels/Steps";
import Verify from "./panels/Verify";

interface VideoMeta { id: string; duration_sec: number | null }

export default function LiveView({ harnesses }: { harnesses: HarnessMeta[] }) {
  const live = useLive();
  const [videos, setVideos] = useState<VideoMeta[]>([]);
  const [harness, setHarness] = useState(harnesses[0]?.id ?? "opencode");
  const [videoId, setVideoId] = useState("");
  const [question, setQuestion] = useState("");

  useEffect(() => {
    fetch("/api/videos")
      .then((r) => r.json())
      .then((v: VideoMeta[]) => { setVideos(v); if (v[0]) setVideoId(v[0].id); })
      .catch(() => setVideos([]));
  }, []);

  // While running, the clock follows the stream; once finished the run becomes an
  // ordinary replay and the transport takes over.
  const duration = live.bundle?.events.length
    ? live.bundle.events[live.bundle.events.length - 1].t
    : 0;
  const clock = useClock(duration);
  const t = live.status === "finished" ? clock.t : live.t;

  const stops = useMemo(
    () => (live.bundle ? [...new Set(live.bundle.events.map((e) => e.t))].sort((a, b) => a - b) : []),
    [live.bundle]
  );

  const meta = harnesses.find((h) => h.id === harness);
  const busy = live.status === "starting" || live.status === "running";

  return (
    <>
      <div className="picker">
        <label>
          <span className="eyebrow">Harness</span>
          <select value={harness} onChange={(e) => setHarness(e.target.value)} disabled={busy}>
            {harnesses.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
        </label>
        <label>
          <span className="eyebrow">Video</span>
          <select value={videoId} onChange={(e) => setVideoId(e.target.value)} disabled={busy}>
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id} ({v.duration_sec ? `${Math.round(v.duration_sec)}s` : "?"})
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: 1, minWidth: "18rem" }}>
          <span className="eyebrow">Your question</span>
          <input
            className="qinput"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What colour is the car in this video?"
            maxLength={240}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy && videoId) live.start(harness, videoId, question);
            }}
          />
        </label>
        <button
          className="go"
          disabled={busy || !videoId || question.trim().length < 8}
          onClick={() => live.start(harness, videoId, question)}
        >
          {busy ? "running…" : "run it"}
        </button>
        {live.status === "finished" && (
          <button onClick={live.reset}>new question</button>
        )}
      </div>

      {live.error && <div className="error">{live.error}</div>}

      <p className="livenote">
        There is no answer key for a question you wrote, so nothing here can tell you whether
        the answer is <em>right</em>. What it can tell you is whether the agent actually looked:
        how many frames it spent, whether the frames it cites exist, and whether the windows it
        claims to have examined are physically possible. That is the whole point — procedure is
        verifiable without an answer key.
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
