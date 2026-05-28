import { formatCommand, type VerificationCommand } from "./runner";
import type { VerificationPhase } from "./config";

export interface VerifierAgentRequest {
  toolName: string;
  cwd: string;
  phase: VerificationPhase;
  commands: VerificationCommand[];
}

export interface VerifierAgentRun {
  state: string;
  finalText: string;
  reason?: string;
}

export type VerifierAgentSpawner = (prompt: { task: string; cwd: string }) => Promise<VerifierAgentRun>;

export function composeVerifierAgentPrompt(request: VerifierAgentRequest): string {
  const commandLines = request.commands.length > 0
    ? request.commands.map((command) => `- ${command.label ?? command.script ?? formatCommand(command)}: \`${formatCommand(command)}\``).join("\n")
    : "- No command stages were resolved. Inspect the repository state and report whether verification can be considered meaningful.";
  return [
    `You are the READ-ONLY verification agent for ${request.toolName}.`,
    "",
    `Working directory: ${request.cwd}`,
    `Verification phase: ${request.phase}`,
    "",
    "Rules:",
    "- Do not edit files.",
    "- Do not run formatting, code generation, migrations, package installs, or any command that mutates the repository.",
    "- You may inspect files and run the verification commands listed below.",
    "- If a listed command is unavailable or cannot run, report that as a failure with evidence.",
    "",
    "Commands to verify:",
    commandLines,
    "",
    "Return exactly one final status line:",
    "- `VERIFICATION: PASS` when the checks pass.",
    "- `VERIFICATION: FAIL` when any check fails or cannot be run.",
    "",
    "Then include concise evidence: command names, exit status, and the key output lines.",
  ].join("\n");
}

export async function runVerifierAgent(request: VerifierAgentRequest, spawn: VerifierAgentSpawner): Promise<string> {
  const run = await spawn({ task: composeVerifierAgentPrompt(request), cwd: request.cwd });
  if (run.state !== "completed") {
    throw new Error(`${request.toolName}: verifier agent failed: ${run.state}${run.reason ? ` (${run.reason})` : ""}`);
  }
  const statuses = [...run.finalText.matchAll(/^VERIFICATION:\s*(PASS|FAIL)\b/gim)].map((match) => match[1]?.toUpperCase());
  if (statuses.length !== 1 || statuses[0] !== "PASS") {
    throw new Error(`${request.toolName}: verifier agent did not approve verification\n${run.finalText.trim()}`);
  }
  return run.finalText;
}
