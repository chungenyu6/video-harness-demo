// Live mode data source.
//
// The panels take (bundle, t) and nothing else, so live does not need a second
// renderer - it needs a Bundle whose events grow. We accumulate incoming events
// into a skeleton, follow the clock to the newest one, and when the server says
// the run is finished we swap in the real exported bundle. From that moment the
// screen is showing exactly what a replay of the same run would show.

import { useCallback, useRef, useState } from "react";
import type { Bundle, HEvent } from "./types";
import { loadBundle } from "./data";

const API = ""; // same origin: the live server mounts the built app at /

export interface LiveState {
  status: "idle" | "starting" | "running" | "finished" | "error";
  bundle: (Bundle & { _dir: string }) | null;
  t: number;
  error: string | null;
  start: (harness: string, videoId: string, question: string) => Promise<void>;
  reset: () => void;
}

function skeleton(harness: string, videoId: string, question: string): Bundle & { _dir: string } {
  return {
    _dir: "",
    bundle_version: "1.0",
    run_id: "(live)",
    harness,
    sample_id: "(live)",
    task: { question, options: [], option_rotation: null, has_gold: false },
    video: { id: videoId, duration_sec: 0, proxy: `video/${videoId}.480p.mp4` },
    budget: { limits: {}, final: {}, ledger: [] },
    frames: [],
    events: [],
    pipeline: { declared: [], actual: [], claimed: [], agrees: true },
    answer: { letter: null, status: "running", frames_processed: null, windows_examined: [], evidence: [] },
    verification: { v0_status: "not_run", checks: {}, errors: [] },
    telemetry: { wall_clock_sec: null, caveats: [] },
  };
}

export function useLive(): LiveState {
  const [status, setStatus] = useState<LiveState["status"]>("idle");
  const [bundle, setBundle] = useState<(Bundle & { _dir: string }) | null>(null);
  const [t, setT] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const src = useRef<EventSource | null>(null);

  const reset = useCallback(() => {
    src.current?.close();
    src.current = null;
    setStatus("idle"); setBundle(null); setT(0); setError(null);
  }, []);

  const start = useCallback(async (harness: string, videoId: string, question: string) => {
    reset();
    setStatus("starting");
    const res = await fetch(`${API}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ harness, video_id: videoId, question }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }));
      setStatus("error");
      setError(typeof body.detail === "string" ? body.detail : "request refused");
      return;
    }
    const { token } = (await res.json()) as { token: string };

    setBundle(skeleton(harness, videoId, question));
    setStatus("running");

    const es = new EventSource(`${API}/api/events/${token}`);
    src.current = es;

    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as HEvent;
      setBundle((b) => (b ? { ...b, events: [...b.events, e] } : b));
      setT(e.t);
    };
    es.addEventListener("bundle", async (m) => {
      const { name } = JSON.parse((m as MessageEvent).data) as { name: string };
      try {
        const full = await loadBundle(name);
        setBundle(full);
        setT(full.events.length ? full.events[full.events.length - 1].t : 0);
      } catch { /* keep the streamed skeleton if the export is unreadable */ }
      setStatus("finished");
    });
    es.addEventListener("error", (m) => {
      const data = (m as MessageEvent).data;
      if (data) { try { setError(JSON.parse(data).error); } catch { /* ignore */ } }
    });
    es.addEventListener("done", () => { es.close(); src.current = null; });
  }, [reset]);

  return { status, bundle, t, error, start, reset };
}
