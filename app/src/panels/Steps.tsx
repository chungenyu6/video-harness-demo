// The normalized trace.
//
// Errors and retries stay inline rather than being tidied away - Pi's
// DATA_DECODE retry is a real difference between the harnesses and hiding it
// would misrepresent the comparison. Raw payloads are one click away so the
// panel stays useful as an internal debugging tool.

import { useEffect, useRef } from "react";
import type { Bundle, HEvent } from "../types";
import { stepLabel } from "../data";

const SHOWN: HEvent["type"][] = [
  "agent.say", "tool.call", "tool.error", "budget.spend",
  "observe.done", "answer.submit", "verify.result",
];

export default function Steps({ bundle, t }: { bundle: Bundle; t: number }) {
  const rows = bundle.events.filter((e) => e.t <= t && SHOWN.includes(e.type));
  const box = useRef<HTMLDivElement | null>(null);
  const last = useRef(0);

  useEffect(() => {
    if (rows.length !== last.current && box.current) {
      box.current.scrollTop = box.current.scrollHeight;
      last.current = rows.length;
    }
  }, [rows.length]);

  return (
    <div className="steps" ref={box}>
      {rows.length === 0 && (
        <div className="step"><span className="tt">—</span><span className="say">waiting…</span></div>
      )}
      {rows.map((e, i) => {
        const isLast = i === rows.length - 1;
        const denied =
          e.type === "budget.spend" &&
          (e.detail as { granted?: boolean } | undefined)?.granted === false;
        return (
          <div key={i} className={`step e-${e.type}${isLast ? " cur" : ""}`}>
            <span className="tt">{e.t.toFixed(1)}</span>
            {e.type === "agent.say" ? (
              <span className="say">{e.text}</span>
            ) : (
              <span>
                <span className={`lab${denied || e.type === "tool.error" ? " bad" : ""}`}>
                  {stepLabel(e)}
                </span>
                {e.type === "tool.call" && e.tool && (
                  <span style={{ color: "var(--ink-3)" }}> · {e.tool}</span>
                )}
                {Boolean(e.args ?? e.detail) && (
                  <details>
                    <summary style={{ color: "var(--ink-3)" }}>▸ raw</summary>
                    <pre>{JSON.stringify(e.args ?? e.detail, null, 1)}</pre>
                  </details>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
