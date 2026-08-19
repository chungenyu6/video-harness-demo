// The shared video panel.
//
// This is the one panel that is NOT per-harness: the video is the common
// subject, and the columns below are two agents' perceptions of it. Putting a
// player in each column would imply each agent watched its own copy.
//
// The toggle is the point of the whole demo. A smooth player quietly implies
// the agent watched the video. It did not - it received a handful of stills.
// Switching to "What the agent saw" collapses the clip to exactly those frames,
// so the gap is something you watch rather than something you are told.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Bundle } from "../types";
import { asset, frameUrl } from "../data";

interface Props {
  bundle: Bundle & { _dir: string };
  /** Video-time position the filmstrip selection points at, or null for free play. */
  seekTo: number | null;
}

export default function Video({ bundle, seekTo }: Props) {
  const [agentView, setAgentView] = useState(false);
  const [idx, setIdx] = useState(0);
  const vref = useRef<HTMLVideoElement | null>(null);

  const seen = useMemo(() => bundle.frames.filter((f) => f.inspected), [bundle]);
  const total = bundle.video.nb_frames ?? null;
  const extracted = bundle.frames.length;

  useEffect(() => {
    if (seekTo === null) return;
    if (agentView) {
      let best = 0;
      seen.forEach((f, i) => {
        if (f.t <= seekTo + 1e-6) best = i;
      });
      setIdx(best);
    } else if (vref.current) {
      vref.current.currentTime = Math.min(seekTo, bundle.video.duration_sec - 0.05);
    }
  }, [seekTo, agentView, seen, bundle.video.duration_sec]);

  const cur = seen[Math.min(idx, Math.max(0, seen.length - 1))];

  return (
    <div className="videowrap">
      <div className="screen">
        {agentView ? (
          cur ? (
            <>
              <img src={frameUrl(bundle._dir, cur.file)} alt={`frame at ${cur.t}s`} />
              <span className="stamp">
                {cur.id} · {cur.t.toFixed(1)}s · {idx + 1}/{seen.length}
              </span>
            </>
          ) : (
            <div className="empty">no frames inspected</div>
          )
        ) : bundle.video.proxy ? (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={vref} src={asset(bundle.video.proxy)} controls preload="metadata" playsInline />
          </>
        ) : (
          <div className="empty">no proxy generated</div>
        )}
      </div>

      <div>
        <div className="toggle" role="group" aria-label="What to show">
          <button aria-pressed={!agentView} onClick={() => setAgentView(false)}>
            What you see
          </button>
          <button aria-pressed={agentView} onClick={() => setAgentView(true)}>
            What the agent saw ({seen.length})
          </button>
        </div>

        {agentView && seen.length > 1 && (
          <div className="transport" style={{ border: "none", background: "transparent", padding: "0.4rem 0 0" }}>
            <button onClick={() => setIdx((i) => Math.max(0, i - 1))} aria-label="previous frame">‹ prev</button>
            <button onClick={() => setIdx((i) => Math.min(seen.length - 1, i + 1))} aria-label="next frame">next ›</button>
            <span className="clock">{cur ? `${cur.t.toFixed(1)}s` : ""}</span>
          </div>
        )}

        <p className="gapline">
          {total ? (
            <>
              The clip is <b>{total.toLocaleString()}</b> frames. crv_prepare kept{" "}
              <b>{extracted}</b>. The VLM was shown <b>{seen.length}</b> —{" "}
              <b>{((seen.length / total) * 100).toFixed(2)}%</b> of the video.
            </>
          ) : (
            <>
              {extracted} frames extracted, {seen.length} shown to the VLM.
            </>
          )}
          <br />
          Every visual claim below rests on those {seen.length} stills. The agent never saw the rest.
        </p>
      </div>
    </div>
  );
}
