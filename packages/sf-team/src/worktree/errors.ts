export type WorktreeCreationStage =
  | "validate"
  | "branch-collision"
  | "git-worktree-add"
  | "install";

export class WorktreeCreationError extends Error {
  readonly stage: WorktreeCreationStage;
  constructor(stage: WorktreeCreationStage, message: string) {
    super(message);
    this.name = "WorktreeCreationError";
    this.stage = stage;
  }
}
