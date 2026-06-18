import { Type, type Static } from "@sinclair/typebox";

export const ConfigSchema = Type.Object(
  {
    reviewer: Type.Optional(
      Type.Object(
        {
          model: Type.Optional(
            Type.String({
              minLength: 1,
              description:
                "Model for the reviewer agent (e.g. 'anthropic/sonnet-4-6')",
            })
          ),
        },
        { additionalProperties: false }
      )
    ),
  },
  { additionalProperties: false }
);

export type PairConfig = Static<typeof ConfigSchema>;

export interface ResolvedPairConfig {
  reviewer: {
    model: string | null;
  };
}

export const DEFAULT_CONFIG: ResolvedPairConfig = {
  reviewer: {
    model: null, // null = not configured, must ask user
  },
};
