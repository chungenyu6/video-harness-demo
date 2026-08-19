// Loading and derivation. Everything the panels render is a pure function of
// (bundle, run-clock position), which is what lets replay and live share one
// renderer: live mode appends events, replay reveals them.

import type { Bundle, HarnessMeta, HEvent } from "./types";

const base = import.meta.env.BASE_URL;

export const asset = (p: string) => `${base}${p.replace(/^\//, "")}`;

export async function loadHarnesses(): Promise<HarnessMeta[]> {
  const r = await fetch(asset("harnesses.json"));
  if (!r.ok) throw new Error(`harnesses.json: ${r.status}`);
  return r.json();
}

export interface ScenarioSpec {
  id: string;
  label: string;
  note?: string;
  bundles: string[];
}

/** Curated scenarios. Optional: without the file the app groups bundles itself,
 *  which is what a freshly exported batch looks like before anyone curates it. */
export async function loadScenarios(): Promise<ScenarioSpec[] | null> {
  const r = await fetch(asset("scenarios.json"));
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

export async function loadBundleIndex(): Promise<string[]> {
  const r = await fetch(asset("bundles/index.json"));
  if (!r.ok) throw new Error(`bundle index: ${r.status}`);
  return r.json();
}

export async function loadBundle(name: string): Promise<Bundle & { _dir: string }> {
  const r = await fetch(asset(`bundles/${name}/bundle.json`));
  if (!r.ok) throw new Error(`bundle ${name}: ${r.status}`);
  const b = (await r.json()) as Bundle;
  return { ...b, _dir: name };
}

/** Frame image URL, resolved against the bundle it came from. */
export const frameUrl = (dir: string, file: string) => asset(`bundles/${dir}/${file}`);

export const runDuration = (b: Bundle) =>
  b.events.length ? b.events[b.events.length - 1].t : 0;

export const eventsUntil = (b: Bundle, t: number) => b.events.filter((e) => e.t <= t);

/** The tool call that is still open at time t, if any. */
export function activeScript(b: Bundle, t: number): string | null {
  let open: { script: string | null; tool: string } | null = null;
  for (const e of b.events) {
    if (e.t > t) break;
    if (e.type === "tool.call") open = { script: e.script ?? null, tool: e.tool ?? "?" };
    else if (e.type === "tool.result" || e.type === "tool.error") open = null;
  }
  return open ? open.script ?? open.tool : null;
}

/** Budget spent per category as of time t, counting only granted reservations. */
export function budgetAt(b: Bundle, t: number): Record<string, number> {
  const spent: Record<string, number> = {};
  for (const k of Object.keys(b.budget.limits)) spent[k] = 0;
  for (const e of b.events) {
    if (e.t > t) break;
    if (e.type !== "budget.spend") continue;
    const d = e.detail as { category?: string; n?: number; granted?: boolean } | undefined;
    if (!d?.category || !d.granted) continue;
    spent[d.category] = (spent[d.category] ?? 0) + (d.n ?? 0);
  }
  return spent;
}

/** Denied reservations up to t — a hard constraint visibly biting. */
export function denialsAt(b: Bundle, t: number): number {
  return b.events.filter(
    (e) => e.t <= t && e.type === "budget.spend" &&
      (e.detail as { granted?: boolean } | undefined)?.granted === false
  ).length;
}

export type FrameState = "pending" | "extracted" | "inspected" | "cited";

/** How far the run has got with each frame at time t. */
export function frameStates(b: Bundle, t: number): FrameState[] {
  const extracted = b.events.some((e) => e.t <= t && e.type === "frames.ready");
  const inspected = b.events.some((e) => e.t <= t && e.type === "observe.done");
  const answered = b.events.some((e) => e.t <= t && e.type === "answer.submit");
  return b.frames.map((f) => {
    if (!extracted) return "pending";
    if (f.cited && answered) return "cited";
    if (f.inspected && inspected) return "inspected";
    return "extracted";
  });
}

export const fmt = (t: number) => `${t.toFixed(1)}s`;

export function stepLabel(e: HEvent): string {
  switch (e.type) {
    case "tool.call": return e.script ?? e.tool ?? "tool";
    case "tool.result": return e.script ?? e.tool ?? "tool";
    case "tool.error": return `${e.tool ?? "tool"} failed`;
    case "budget.spend": {
      const d = e.detail as { category?: string; n?: number; granted?: boolean };
      return `${d?.granted ? "reserved" : "DENIED"} ${d?.n} ${d?.category}`;
    }
    case "observe.done": return "VLM observation";
    case "frames.ready": return "frames extracted";
    case "answer.submit": return "answer submitted";
    case "verify.result": return "V0 verification";
    default: return e.type;
  }
}


/** One selectable demo: a video plus a question, with one run per harness. */
export interface Scenario {
  key: string;
  videoId: string;
  question: string;
  options: string[];
  runs: (Bundle & { _dir: string })[];
  label?: string;
  note?: string;
  /** sample_id when this came from the task file - lets live mode reuse the
   *  original options instead of the generic yes/no set. */
  sampleId?: string;
}

/** One video with every scenario recorded against it.
 *  Derived from the bundles, never declared: a video is offered exactly when
 *  there is a run to show for it. Shared by the replay picker and live mode so
 *  the two cannot drift apart. */
export interface VideoGroup {
  id: string;
  label: string;
  durationSec: number;
  thumb: string | null;
  scenarios: Scenario[];
}

const FEATURED = "Featured";

export function groupByVideo(scenarios: Scenario[]): VideoGroup[] {
  const map = new Map<string, VideoGroup>();
  for (const s of scenarios) {
    const run = s.runs[0];
    if (!run) continue;
    const id = run.video.id;
    if (!map.has(id)) {
      const label = s.label?.includes(" — ") ? s.label.split(" — ")[0] : id;
      const first = run.frames[0];
      map.set(id, {
        id,
        label: s.label?.startsWith(FEATURED) ? id : label,
        durationSec: run.video.duration_sec,
        thumb: first ? frameUrl(run._dir, first.file) : null,
        scenarios: [],
      });
    }
    map.get(id)!.scenarios.push(s);
  }
  for (const g of map.values()) {
    // A featured pairing leads its video's list - it is the one worth watching.
    g.scenarios.sort((a, b) => Number(b.label?.startsWith(FEATURED) ?? false) -
                               Number(a.label?.startsWith(FEATURED) ?? false));
    if (g.label === g.id) {
      // Skip featured entries here: their label starts with "Featured", so using
      // one names the video "Featured" instead of what it shows.
      const named = g.scenarios.find(
        (x) => x.label?.includes(" — ") && !x.label.startsWith(FEATURED)
      );
      if (named) g.label = named.label!.split(" — ")[0];
    }
  }
  return [...map.values()];
}

/** Distinct questions asked of a video, for live mode's suggestions. */
export function suggestionsFor(group: VideoGroup): { question: string; sampleId?: string }[] {
  const seen = new Set<string>();
  const out: { question: string; sampleId?: string }[] = [];
  for (const s of group.scenarios) {
    if (seen.has(s.question)) continue;
    seen.add(s.question);
    out.push({ question: s.question, sampleId: s.sampleId });
  }
  return out;
}
