// Frames on the video's own time axis.
//
// The signature visual, and the one most agent demos cannot have, because most
// agents act on a medium with no time axis. State is revealed by the run clock:
// a frame is dim until crv_prepare finishes, lit when the VLM has seen it, and
// ringed once the agent cites it as evidence.

import type { Bundle } from "../types";
import { frameStates, frameUrl } from "../data";

interface Props {
  bundle: Bundle & { _dir: string };
  t: number;
  selected: number | null;
  onSelect: (i: number | null) => void;
}

export default function Filmstrip({ bundle, t, selected, onSelect }: Props) {
  const states = frameStates(bundle, t);
  const dur = bundle.video.duration_sec;

  return (
    <div>
      <div className="strip">
        {bundle.frames.map((f, i) => {
          const st = states[i];
          const title =
            `${f.id} @ ${f.t.toFixed(1)}s\n` +
            (f.observation ? `\n${f.observation}` : "\n(never shown to the VLM)") +
            (f.cited ? "\n\n★ cited as evidence" : "");
          return (
            <button
              key={f.id}
              className={`cell s-${st}${selected === i ? " sel" : ""}`}
              title={title}
              aria-label={title}
              onClick={() => onSelect(selected === i ? null : i)}
            >
              <img src={frameUrl(bundle._dir, f.file)} alt="" loading="lazy" />
              {st === "cited" && <span className="dot" />}
            </button>
          );
        })}
      </div>
      <div className="axis">
        <span>0.0s</span>
        <span>{(dur / 2).toFixed(1)}s</span>
        <span>{dur.toFixed(1)}s</span>
      </div>
    </div>
  );
}
