// Mirrors schema/bundle.schema.json. The UI knows only this shape; it never
// reads a run directory and never special-cases a harness.

export type EventType =
  | "run.start" | "step.begin" | "agent.say" | "tool.call" | "tool.result"
  | "tool.error" | "budget.spend" | "frames.ready" | "observe.done"
  | "answer.submit" | "verify.result" | "run.end";

export interface HEvent {
  t: number;
  type: EventType;
  tool?: string;
  script?: string;
  text?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  detail?: unknown;
  elapsed_sec?: number;
}

export interface Frame {
  id: string;
  t: number;
  file: string;
  selection_reason?: string | null;
  inspected: boolean;
  cited: boolean;
  observation?: string | null;
}

export interface BudgetRow {
  category: string; n: number; tool: string; granted: boolean;
  used_before?: number | null; limit?: number | null;
}

export interface Bundle {
  bundle_version: string;
  run_id: string;
  harness: string;
  sample_id: string;
  task: {
    question: string; options: string[];
    option_rotation: number | null; duration_label?: string | null;
    has_gold: boolean;
    gold?: string | null;
  };
  video: {
    id: string; duration_sec: number; fps?: number | null;
    width?: number | null; height?: number | null;
    nb_frames?: number | null; proxy?: string | null;
  };
  budget: {
    limits: Record<string, number>;
    final: Record<string, number>;
    ledger: BudgetRow[];
  };
  frames: Frame[];
  events: HEvent[];
  pipeline: { declared: string[]; actual: string[]; claimed: string[]; agrees?: boolean };
  answer: {
    letter: string | null; status: string; frames_processed: number | null;
    correct?: boolean | null;
    windows_examined: number[][];
    evidence: { t: number; frame: string; claim: string }[];
  };
  verification: {
    v0_status: "pass" | "fail" | "not_run";
    checks: Record<string, boolean>;
    errors: string[];
    leak_status?: string | null;
    boundary_probes?: { path: string; blocked: true }[];
    does_not_validate?: string[];
  };
  telemetry: { wall_clock_sec: number | null; layers?: unknown; caveats: string[] };
}

export interface HarnessMeta {
  id: string;
  label: string;
  color: string;
  note?: string;
}
