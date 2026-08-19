// Declared procedure with the actual path traced on it.
//
// The untaken branch carries as much information as the taken one: a dashed,
// faded extract_window tells a viewer "coarse sampling settled this question"
// faster than any sentence. And where the agent's self-reported tool_trace
// disagrees with the ledger-derived path, the difference is drawn rather than
// described - that is exactly what V0 catches in rep_84.

import type { Bundle } from "../types";
import { activeScript } from "../data";

const CANONICAL = ["probe_video", "crv_prepare", "vlm_inspect", "extract_window", "submit_evidence"];

interface Props { bundle: Bundle; t: number; }

export default function Pipeline({ bundle, t }: Props) {
  const live = activeScript(bundle, t);
  const doneCounts = new Map<string, number>();
  for (const e of bundle.events) {
    if (e.t > t) break;
    if (e.type === "tool.call" && e.script) {
      doneCounts.set(e.script, (doneCounts.get(e.script) ?? 0) + 1);
    }
  }

  const claimedOnly = bundle.pipeline.claimed.filter(
    (s) => !bundle.pipeline.actual.includes(s)
  );

  return (
    <div>
      <div className="pipe">
        {CANONICAL.map((node, i) => {
          const n = doneCounts.get(node) ?? 0;
          const cls = live === node ? "live" : n > 0 ? "done" : "untaken";
          return (
            <span key={node} style={{ display: "contents" }}>
              {i > 0 && <span className="arrow">→</span>}
              <span className={`node ${cls}`} title={n > 1 ? `called ${n}×` : undefined}>
                {node}
                {n > 1 && <span className="rep"> ×{n}</span>}
              </span>
            </span>
          );
        })}
      </div>

      {claimedOnly.length > 0 && (
        <div className="pipe" style={{ marginTop: "0.35rem" }}>
          <span className="eyebrow" style={{ marginRight: "0.3rem" }}>claimed only</span>
          {claimedOnly.map((s) => (
            <span key={s} className="node phantom" title="in the agent's tool_trace but not in the tool logs">
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
