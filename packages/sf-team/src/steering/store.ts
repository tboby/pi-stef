import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { assertPathInsideRoot, assertSafeSnapshotName } from "./path-safety";
import { truncateGuidanceText } from "./guidance-sanitize";
import type {
  ActiveAgentRecord,
  AppliedSteeringInstruction,
  SteeringAgentAction,
  SteeringDecision,
  SteeringGuidance,
  SteeringGuidanceScope,
  SteeringGuidanceScopeKind,
  SteeringInstruction,
  SteeringInstructionStatus,
  SteeringPauseState,
} from "./types";

const DEFAULT_MAX_INSTRUCTION_CHARS = 4000;

export interface SteeringStoreConfig {
  maxInstructionChars?: number;
}

export interface SteeringStoreOptions {
  rootDir: string;
  expectedRoot: string;
  config?: SteeringStoreConfig;
}

export interface AppendGuidanceInput {
  instructionId: string;
  workflowId: string;
  scope: SteeringGuidanceScope;
  text: string;
  source: SteeringGuidance["source"];
}

export interface SteeringStore {
  readonly rootDir: string;
  appendInstruction(input: Omit<SteeringInstruction, "id" | "receivedAt" | "status">): Promise<SteeringInstruction>;
  listInstructions(filter?: { statuses?: SteeringInstructionStatus[] }): Promise<SteeringInstruction[]>;
  updateInstructionStatus(id: string, status: SteeringInstructionStatus): Promise<void>;
  appendDecision(decision: SteeringDecision): Promise<void>;
  listDecisions(): Promise<SteeringDecision[]>;
  appendAppliedInstruction(entry: AppliedSteeringInstruction): Promise<void>;
  listAppliedInstructions(): Promise<AppliedSteeringInstruction[]>;
  appendAgentAction(action: SteeringAgentAction): Promise<void>;
  listAgentActions(): Promise<SteeringAgentAction[]>;
  readActiveAgents(): Promise<ActiveAgentRecord[]>;
  readActiveAgentsState(): Promise<{ version: number; records: ActiveAgentRecord[] }>;
  writeActiveAgents(records: ActiveAgentRecord[]): Promise<void>;
  upsertActiveAgents(records: ActiveAgentRecord[]): Promise<void>;
  patchActiveAgent(id: string, patch: Partial<ActiveAgentRecord>): Promise<void>;
  removeActiveAgents(ids: string[]): Promise<void>;
  writeSnapshot(name: string, snapshot: unknown): Promise<void>;
  appendGuidance(input: AppendGuidanceInput): Promise<SteeringGuidance>;
  activateGuidance(id: string): Promise<void>;
  expireGuidance(id: string, reason: string): Promise<void>;
  listGuidance(): Promise<SteeringGuidance[]>;
  listActiveGuidance(): Promise<SteeringGuidance[]>;
  listPendingActivationGuidance(): Promise<SteeringGuidance[]>;
  expireGuidanceForScope(kind: SteeringGuidanceScopeKind, target?: string): Promise<SteeringGuidance[]>;
  expireGuidanceForInstruction(instructionId: string, reason: string): Promise<SteeringGuidance[]>;
  readPauseState(): Promise<SteeringPauseState | null>;
  setPauseState(state: SteeringPauseState | null): Promise<void>;
}

interface SteeringStateFile {
  instructionStatuses: Record<string, SteeringInstructionStatus>;
  pauseState?: SteeringPauseState | null;
}

interface ActiveAgentsFile {
  version: number;
  records: ActiveAgentRecord[];
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const STORE_MUTEXES = new Map<string, AsyncMutex>();

export function createSteeringStore(options: SteeringStoreOptions): SteeringStore {
  const rootDir = assertPathInsideRoot(options.rootDir, options.expectedRoot);
  const mutex = STORE_MUTEXES.get(rootDir) ?? new AsyncMutex();
  STORE_MUTEXES.set(rootDir, mutex);
  return new FileSteeringStore(rootDir, mutex, options.config ?? {});
}

class FileSteeringStore implements SteeringStore {
  readonly rootDir: string;
  private readonly maxInstructionChars: number;

  constructor(
    rootDir: string,
    private readonly mutex: AsyncMutex,
    config: SteeringStoreConfig,
  ) {
    this.rootDir = rootDir;
    this.maxInstructionChars = config.maxInstructionChars ?? DEFAULT_MAX_INSTRUCTION_CHARS;
  }

  async appendInstruction(input: Omit<SteeringInstruction, "id" | "receivedAt" | "status">): Promise<SteeringInstruction> {
    if (input.text.length > this.maxInstructionChars) {
      throw new Error(`Steering instruction exceeds maximum length of ${this.maxInstructionChars} characters`);
    }

    return await this.mutex.run(async () => {
      await this.ensureRoot();
      const instruction: SteeringInstruction = {
        ...input,
        id: randomUUID(),
        receivedAt: new Date().toISOString(),
        status: "queued",
      };
      await appendJsonl(this.path("inbox.jsonl"), instruction);
      return instruction;
    });
  }

  async listInstructions(filter: { statuses?: SteeringInstructionStatus[] } = {}): Promise<SteeringInstruction[]> {
    return await this.mutex.run(async () => {
      const instructions = await readJsonl<SteeringInstruction>(this.path("inbox.jsonl"));
      const state = await this.readStateUnlocked();
      const statusSet = filter.statuses ? new Set(filter.statuses) : undefined;
      return instructions
        .map((instruction) => ({
          ...instruction,
          status: state.instructionStatuses[instruction.id] ?? instruction.status,
        }))
        .filter((instruction) => !statusSet || statusSet.has(instruction.status));
    });
  }

  async updateInstructionStatus(id: string, status: SteeringInstructionStatus): Promise<void> {
    await this.mutex.run(async () => {
      await this.ensureRoot();
      const state = await this.readStateUnlocked();
      state.instructionStatuses[id] = status;
      await writeJsonAtomic(this.path("state.json"), state);
    });
  }

  async appendDecision(decision: SteeringDecision): Promise<void> {
    await this.mutex.run(async () => {
      await this.ensureRoot();
      await appendJsonl(this.path("decisions.jsonl"), decision);
    });
  }

  async listDecisions(): Promise<SteeringDecision[]> {
    return await this.mutex.run(async () => await readJsonl<SteeringDecision>(this.path("decisions.jsonl")));
  }

  async appendAppliedInstruction(entry: AppliedSteeringInstruction): Promise<void> {
    await this.mutex.run(async () => {
      await this.ensureRoot();
      const applied = await readJsonl<AppliedSteeringInstruction>(this.path("applied-instructions.jsonl"));
      if (applied.some((candidate) => candidate.instructionId === entry.instructionId)) return;
      await appendJsonl(this.path("applied-instructions.jsonl"), entry);
    });
  }

  async listAppliedInstructions(): Promise<AppliedSteeringInstruction[]> {
    return await this.mutex.run(async () => await readJsonl<AppliedSteeringInstruction>(this.path("applied-instructions.jsonl")));
  }

  async appendAgentAction(action: SteeringAgentAction): Promise<void> {
    await this.mutex.run(async () => {
      await this.ensureRoot();
      await appendJsonl(this.path("agent-actions.jsonl"), action);
    });
  }

  async listAgentActions(): Promise<SteeringAgentAction[]> {
    return await this.mutex.run(async () => await readJsonl<SteeringAgentAction>(this.path("agent-actions.jsonl")));
  }

  async readActiveAgents(): Promise<ActiveAgentRecord[]> {
    return await this.mutex.run(async () => (await this.readActiveAgentsFileUnlocked()).records);
  }

  async readActiveAgentsState(): Promise<{ version: number; records: ActiveAgentRecord[] }> {
    return await this.mutex.run(async () => {
      const current = await this.readActiveAgentsFileUnlocked();
      return { version: current.version, records: current.records };
    });
  }

  async writeActiveAgents(records: ActiveAgentRecord[]): Promise<void> {
    await this.mutex.run(async () => {
      await this.ensureRoot();
      const current = await this.readActiveAgentsFileUnlocked();
      await writeJsonAtomic(this.path("active-agents.json"), {
        version: current.version + 1,
        records,
      } satisfies ActiveAgentsFile);
    });
  }

  async upsertActiveAgents(records: ActiveAgentRecord[]): Promise<void> {
    await this.mutex.run(async () => {
      await this.ensureRoot();
      const current = await this.readActiveAgentsFileUnlocked();
      const byId = new Map(current.records.map((record) => [record.id, record]));
      for (const record of records) byId.set(record.id, record);
      await writeJsonAtomic(this.path("active-agents.json"), {
        version: current.version + 1,
        records: [...byId.values()],
      } satisfies ActiveAgentsFile);
    });
  }

  async patchActiveAgent(id: string, patch: Partial<ActiveAgentRecord>): Promise<void> {
    await this.mutex.run(async () => {
      await this.ensureRoot();
      const current = await this.readActiveAgentsFileUnlocked();
      const next = current.records.map((record) => record.id === id ? { ...record, ...patch } : record);
      await writeJsonAtomic(this.path("active-agents.json"), {
        version: current.version + 1,
        records: next,
      } satisfies ActiveAgentsFile);
    });
  }

  async removeActiveAgents(ids: string[]): Promise<void> {
    await this.mutex.run(async () => {
      await this.ensureRoot();
      const removeIds = new Set(ids);
      const current = await this.readActiveAgentsFileUnlocked();
      await writeJsonAtomic(this.path("active-agents.json"), {
        version: current.version + 1,
        records: current.records.filter((record) => !removeIds.has(record.id)),
      } satisfies ActiveAgentsFile);
    });
  }

  async writeSnapshot(name: string, snapshot: unknown): Promise<void> {
    await this.mutex.run(async () => {
      await mkdir(this.path("snapshots"), { recursive: true });
      await writeJsonAtomic(path.join(this.path("snapshots"), assertSafeSnapshotName(name)), snapshot);
    });
  }

  async appendGuidance(input: AppendGuidanceInput): Promise<SteeringGuidance> {
    return await this.mutex.run(async () => {
      await this.ensureRoot();
      const record: SteeringGuidance = {
        id: randomUUID(),
        instructionId: input.instructionId,
        workflowId: input.workflowId,
        appendedAt: new Date().toISOString(),
        scope: { kind: input.scope.kind, target: input.scope.target },
        text: truncateGuidanceText(input.text),
        source: input.source,
        status: "pending-activation",
      };
      await appendJsonl(this.path("guidance.jsonl"), record);
      return record;
    });
  }

  async activateGuidance(id: string): Promise<void> {
    await this.mutex.run(async () => {
      await this.ensureRoot();
      const current = await readJsonl<SteeringGuidance>(this.path("guidance.jsonl"));
      const target = current.find((row) => row.id === id);
      if (!target) return;
      if (target.status === "expired") return;
      await appendJsonl(this.path("guidance.jsonl"), { ...target, status: "active" });
    });
  }

  async expireGuidance(id: string, reason: string): Promise<void> {
    await this.mutex.run(async () => {
      await this.ensureRoot();
      const current = await readJsonl<SteeringGuidance>(this.path("guidance.jsonl"));
      const target = collapseGuidance(current).find((row) => row.id === id);
      if (!target) return;
      if (target.status === "expired") return;
      await appendJsonl(this.path("guidance.jsonl"), { ...target, status: "expired", expireReason: reason });
    });
  }

  async listGuidance(): Promise<SteeringGuidance[]> {
    return await this.mutex.run(async () => {
      const all = await readJsonl<SteeringGuidance>(this.path("guidance.jsonl"));
      return collapseGuidance(all);
    });
  }

  async listActiveGuidance(): Promise<SteeringGuidance[]> {
    return await this.mutex.run(async () => {
      const all = await readJsonl<SteeringGuidance>(this.path("guidance.jsonl"));
      const collapsed = collapseGuidance(all);
      const state = await this.readStateUnlocked();
      // Derived-active predicate: guidance.status === "active" AND
      // instruction.status === "applied".
      return collapsed.filter(
        (row) => row.status === "active"
          && state.instructionStatuses[row.instructionId] === "applied",
      );
    });
  }

  async listPendingActivationGuidance(): Promise<SteeringGuidance[]> {
    return await this.mutex.run(async () => {
      const all = await readJsonl<SteeringGuidance>(this.path("guidance.jsonl"));
      return collapseGuidance(all).filter((row) => row.status === "pending-activation");
    });
  }

  /**
   * Expire active/pending guidance rows whose scope matches.
   *
   * - `kind === "workflow"`: when `target` is provided it is matched against
   *   `row.workflowId` (workflow-scoped rows do not carry a `scope.target`).
   *   When `target` is undefined all workflow-scoped rows are expired.
   * - `kind === "milestone" | "story" | "role"`: `target` is matched against
   *   `row.scope.target`.
   */
  async expireGuidanceForScope(
    kind: SteeringGuidanceScopeKind,
    target?: string,
  ): Promise<SteeringGuidance[]> {
    return await this.mutex.run(async () => {
      await this.ensureRoot();
      const all = await readJsonl<SteeringGuidance>(this.path("guidance.jsonl"));
      const collapsed = collapseGuidance(all);
      const expired: SteeringGuidance[] = [];
      for (const row of collapsed) {
        if (row.status === "expired") continue;
        if (row.scope.kind !== kind) continue;
        if (target !== undefined) {
          const compareTo = kind === "workflow" ? row.workflowId : row.scope.target;
          if (compareTo !== target) continue;
        }
        const next: SteeringGuidance = {
          ...row,
          status: "expired",
          expireReason: `scope-complete:${kind}${target ? `:${target}` : ""}`,
        };
        await appendJsonl(this.path("guidance.jsonl"), next);
        expired.push(next);
      }
      return expired;
    });
  }

  async expireGuidanceForInstruction(
    instructionId: string,
    reason: string,
  ): Promise<SteeringGuidance[]> {
    return await this.mutex.run(async () => {
      await this.ensureRoot();
      const all = await readJsonl<SteeringGuidance>(this.path("guidance.jsonl"));
      const collapsed = collapseGuidance(all);
      const expired: SteeringGuidance[] = [];
      for (const row of collapsed) {
        if (row.status === "expired") continue;
        if (row.instructionId !== instructionId) continue;
        const next: SteeringGuidance = { ...row, status: "expired", expireReason: reason };
        await appendJsonl(this.path("guidance.jsonl"), next);
        expired.push(next);
      }
      return expired;
    });
  }

  async readPauseState(): Promise<SteeringPauseState | null> {
    return await this.mutex.run(async () => {
      const state = await this.readStateUnlocked();
      return state.pauseState ?? null;
    });
  }

  async setPauseState(next: SteeringPauseState | null): Promise<void> {
    await this.mutex.run(async () => {
      await this.ensureRoot();
      const state = await this.readStateUnlocked();
      state.pauseState = next;
      await writeJsonAtomic(this.path("state.json"), state);
    });
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  private path(fileName: string): string {
    return path.join(this.rootDir, fileName);
  }

  private async readStateUnlocked(): Promise<SteeringStateFile> {
    return await readJsonFile(this.path("state.json"), { instructionStatuses: {} });
  }

  private async readActiveAgentsFileUnlocked(): Promise<ActiveAgentsFile> {
    return await readJsonFile(this.path("active-agents.json"), { version: 0, records: [] });
  }
}

async function appendJsonl(filePath: string, value: unknown): Promise<void> {
  await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }

  const entries: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      entries.push(JSON.parse(line) as T);
    } catch {
      // Malformed JSONL lines are ignored so one bad append cannot hide the
      // rest of the durable instruction history.
    }
  }
  return entries;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (err) {
    if (isNotFound(err)) return fallback;
    throw err;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  } catch (err) {
    await unlink(tempPath).catch(() => undefined);
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

/**
 * Collapse the append-only guidance log so each guidance id surfaces with
 * its latest-written row. Earlier rows in the file are superseded by later
 * rows; this is the on-read materialization of the JSONL "latest-wins"
 * contract documented in store interface comments.
 */
function collapseGuidance(rows: SteeringGuidance[]): SteeringGuidance[] {
  const byId = new Map<string, SteeringGuidance>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}
