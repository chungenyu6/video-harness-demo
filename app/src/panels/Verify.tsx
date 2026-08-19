// V0's verdict, plus the answer it is a verdict about.
//
// The check grid is rendered from whatever the bundle carries, never a fixed
// count: Pi's runs get 25 checks and OpenCode's get 23, because Pi needs a
// sampling extension to reach parity and that extension is itself verified.
// Hardcoding 23 would have quietly mislabelled every Pi run.

import { useState } from "react";
import type { Bundle } from "../types";
import { CHECKS, NOT_CHECKED } from "../checks";

export default function Verify({ bundle, t }: { bundle: Bundle; t: number }) {
  const [open, setOpen] = useState(false);
  const answered = bundle.events.some((e) => e.t <= t && e.type === "answer.submit");
  const verified = bundle.events.some((e) => e.t <= t && e.type === "verify.result");
  const v = bundle.verification;
  const names = Object.keys(v.checks).sort();

  return (
    <div>
      {answered ? (
        <>
          <div className="answer">
            <span className="letter">{bundle.answer.letter ?? "?"}</span>
            <span style={{ fontWeight: 400, fontSize: "0.85rem", color: "var(--ink-2)" }}>
              {bundle.answer.status} · {bundle.answer.frames_processed} frames claimed
            </span>
          </div>
          <ol className="evidence">
            {bundle.answer.evidence.map((e, i) => (
              <li key={i}>
                <span className="ts">{e.t.toFixed(1)}s</span> {e.claim}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div style={{ fontFamily: "var(--mono)", fontSize: "0.72rem", color: "var(--ink-3)" }}>
          not yet answered
        </div>
      )}

      <div className="section-label">
        V0 · {names.length} checks{" "}
        {verified && (
          <span className={`pill ${v.v0_status === "pass" ? "p-pass" : "p-fail"}`}>
            {v.v0_status}
          </span>
        )}
      </div>
      <div className="checks" aria-label={`${names.length} procedural checks`}>
        {names.map((n) => (
          <span
            key={n}
            className={`chk${verified ? (v.checks[n] ? " ok" : " no") : ""}`}
            title={`${n}: ${verified ? (v.checks[n] ? "pass" : "FAIL") : "pending"}\n${CHECKS[n]?.what ?? ""}`}
          />
        ))}
      </div>

      <button className="disclose" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} what these {names.length} checks are
      </button>

      {open && (
        <div className="checklist">
          {names.map((n) => {
            const info = CHECKS[n];
            const state = verified ? (v.checks[n] ? "ok" : "no") : "";
            return (
              <div className="ck" key={n}>
                <span className={`chk ${state}`} />
                <div>
                  <code>{n}</code>
                  <p>{info?.what ?? "(no description recorded)"}</p>
                  {info?.why && <p className="why">{info.why}</p>}
                </div>
              </div>
            );
          })}
          <p className="cknote">
            Counts differ by harness. Pi's runs carry two extra checks —
            <code>sampling_matches_config</code> and <code>sampling_pin_evidence</code> —
            because Pi reaches sampling parity through an extension, so the extension is
            verified rather than assumed. The two harnesses are therefore not scored by an
            identical check set.
          </p>
          <p className="cknote">
            <b>What V0 does not check:</b> {NOT_CHECKED.join("; ")}. It validates procedure
            and artifacts, not meaning.
          </p>
        </div>
      )}

      {verified && v.errors.map((e, i) => <div className="verr" key={i}>{e}</div>)}

      {verified && (v.boundary_probes?.length ?? 0) > 0 && (
        <div className="vnote">
          agent probed {v.boundary_probes!.map((p) => p.path).join(", ")} — refused by the
          kernel. The isolation boundary was exercised and held.
        </div>
      )}

      {verified && !bundle.pipeline.agrees && (
        <div className="vnote">
          self-reported tool_trace differs from the ledger-derived path
        </div>
      )}
    </div>
  );
}
