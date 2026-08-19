// What each V0 check actually asserts.
//
// The names come from the bundle, so this map only supplies prose. A check with
// no entry still renders - it just shows its raw name, which is better than
// pretending the list is closed.
//
// On the count: most runs carry 23 checks, Pi's carry 25 (26 after D024 added
// tamper_tools). The two extra are sampling_matches_config and
// sampling_pin_evidence, and they exist because Pi needs a sampling extension to
// send the same temperature and top_p OpenCode sends natively - so that
// extension is itself something to verify. It means the two harnesses are not
// scored by an identical check set, which is worth knowing before reading any
// comparison.

export interface CheckInfo { what: string; why?: string }

export const CHECKS: Record<string, CheckInfo> = {
  run_json_present: { what: "The run has a metadata record at all." },
  evidence_present: { what: "The agent actually submitted an answer." },
  evidence_parses: { what: "That submission is readable JSON." },
  schema: { what: "It matches the frozen evidence schema.",
            why: "The schema is hashed before the run; the agent cannot loosen it." },
  tamper_verifier: { what: "The checker's own file is unchanged since the run started.",
                     why: "A checker an agent could edit is not a checker." },
  tamper_evidence_schema: { what: "The evidence contract is unchanged since the run started." },
  tamper_tools: { what: "The perception scripts are unchanged since the run started.",
                  why: "Those scripts write the budget ledger this report is checked against. Added after they were found to be replaceable by the agent." },
  task_input_present: { what: "The question the agent was given is on record." },
  sample_id_matches: { what: "The answer is for the sample that was actually asked." },
  answer_in_options: { what: "The answer is one of the offered options." },
  video_probeable: { what: "The video file still decodes and has the duration claimed." },
  timestamp_bounds: { what: "Every cited timestamp falls inside the video." },
  frame_files: { what: "Every frame cited as evidence exists on disk." },
  frame_run_owned: { what: "Those frames were produced by THIS run.",
                     why: "Stops evidence being borrowed from another run." },
  windows_valid: { what: "Every window the agent says it examined is inside the video.",
                   why: "This is what catches a claim of examining 0-101.6s of a 42-second clip." },
  budget: { what: "No budget category exceeded its limit." },
  budget_ledger_agrees: { what: "The frame count the agent reported matches the tools' ledger.",
                          why: "Recomputed from logs the agent does not write. Catches both over- and under-reporting." },
  trace_present: { what: "A tool trace was recorded." },
  tool_logs_present: { what: "The instrumented tools wrote their logs." },
  agent_trace_present: { what: "The harness's own event log exists." },
  exit_status_recorded: { what: "How the agent process ended is on record." },
  service_refs: { what: "The model servers used are identified by id." },
  environment_snapshot: { what: "The machine state was captured at run time." },
  run_dir_was_new: { what: "The run wrote into a fresh directory.",
                     why: "No reusing an output path, so results cannot be quietly overwritten." },
  sampling_matches_config: { what: "The sampling parameters sent match the pinned config.",
                             why: "Pi only. It reaches parity through an extension, so the parity is verified rather than assumed." },
  sampling_pin_evidence: { what: "There is on-the-wire proof of that pinning.",
                           why: "Pi only." },
};

export const NOT_CHECKED = [
  "whether a frame semantically supports the claim made about it",
  "whether the evidence justifies the final answer",
  "whether the model hallucinated",
  "whether the temporal coverage was sufficient",
];
