// Every tool the agent could reach for, always visible.
//
// Showing the unused ones is the point: it answers "what is the environment"
// without a diagram, and an idle tool is as informative as a busy one.

import type { Bundle } from "../types";
import { activeScript } from "../data";

const HARNESS_TOOLS = ["bash", "read", "write"];
const SCRIPTS = ["probe_video", "crv_prepare", "vlm_inspect", "extract_window", "submit_evidence"];

export default function ToolRack({ bundle, t }: { bundle: Bundle; t: number }) {
  const live = activeScript(bundle, t);
  const usedTools = new Set<string>();
  const usedScripts = new Set<string>();
  let liveTool: string | null = null;

  for (const e of bundle.events) {
    if (e.t > t) break;
    if (e.type === "tool.call") {
      if (e.tool) usedTools.add(e.tool);
      if (e.script) usedScripts.add(e.script);
      liveTool = e.tool ?? null;
    } else if (e.type === "tool.result" || e.type === "tool.error") {
      liveTool = null;
    }
  }

  const cls = (used: boolean, isLive: boolean) =>
    isLive ? "tool live" : used ? "tool used" : "tool idle";

  return (
    <div>
      <div className="rack" title="Harness built-in tools (forced identical on both harnesses)">
        {HARNESS_TOOLS.map((x) => (
          <span key={x} className={cls(usedTools.has(x), liveTool === x)}>{x}</span>
        ))}
      </div>
      <div className="rack" style={{ marginTop: 3 }} title="Instrumented perception scripts">
        {SCRIPTS.map((x) => (
          <span key={x} className={cls(usedScripts.has(x), live === x)}>{x}</span>
        ))}
      </div>
    </div>
  );
}
