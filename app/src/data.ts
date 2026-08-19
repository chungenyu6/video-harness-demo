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
