export type ResumeNotFoundKind = "not-found" | "ambiguous";

export class ResumeTargetNotFoundError extends Error {
  readonly kind: ResumeNotFoundKind;
  readonly slug: string;
  readonly candidates: string[];

  constructor(args: {
    kind: ResumeNotFoundKind;
    slug: string;
    candidates: string[];
    message: string;
  }) {
    super(args.message);
    this.name = "ResumeTargetNotFoundError";
    this.kind = args.kind;
    this.slug = args.slug;
    this.candidates = args.candidates;
  }
}
