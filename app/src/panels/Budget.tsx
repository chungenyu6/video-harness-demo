// Perception budget, depleting live.
//
// A denied reservation is the most valuable thing this panel can show: a hard
// limit visibly biting beats a paragraph claiming one exists. rep_81 hit the
// coarse ceiling twice and the ledger recorded both refusals.

import type { Bundle } from "../types";
import { budgetAt, denialsAt } from "../data";

const LABEL: Record<string, string> = {
  coarse_frames: "coarse",
  dense_frames: "dense",
  vlm_inspected_frames: "vlm frames",
};

export default function Budget({ bundle, t }: { bundle: Bundle; t: number }) {
  const spent = budgetAt(bundle, t);
  const denied = denialsAt(bundle, t);
  const limits = bundle.budget.limits ?? {};

  return (
    <div>
      {Object.entries(limits).map(([k, lim]) => {
        const used = spent[k] ?? 0;
        const pct = lim > 0 ? Math.min(100, (used / lim) * 100) : 0;
        return (
          <div className="gauge" key={k}>
            <div className="gauge-lab">
              <span>{LABEL[k] ?? k}</span>
              <span>{used} / {lim}</span>
            </div>
            <div className="bar-bg">
              <div className={`bar-fg${pct >= 100 ? " full" : ""}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      {denied > 0 && (
        <div className="denied">
          {denied} reservation{denied > 1 ? "s" : ""} refused — budget exhausted
        </div>
      )}
    </div>
  );
}
