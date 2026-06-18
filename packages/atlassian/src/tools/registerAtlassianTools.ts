import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerConfluenceTools } from "../confluence/tools";
import { registerJiraSoftwareTools } from "../jira/softwareTools";
import { registerJiraPlatformTools } from "../jira/tools";

export function registerAtlassianTools(pi: ExtensionAPI): void {
  registerConfluenceTools(pi);
  registerJiraPlatformTools(pi);
  registerJiraSoftwareTools(pi);
  registerCommands(pi);
}

function registerCommands(pi: ExtensionAPI): void {
  if (typeof pi.registerCommand !== "function") return;
  const send = typeof pi.sendUserMessage === "function" ? pi.sendUserMessage.bind(pi) : undefined;

  function postPrompt(message: string, ctx: { isIdle?: () => boolean }): void {
    if (send) {
      const idle = typeof ctx.isIdle === "function" ? ctx.isIdle() : true;
      if (idle) send(message);
      else send(message, { deliverAs: "followUp" });
    }
  }

  pi.registerCommand("jira-issue", {
    description: "Fetch a Jira issue with full context",
    handler: async (args: string, ctx: { isIdle?: () => boolean }) => {
      const key = args.trim();
      if (!key) return;
      postPrompt(`Use jira_issue to fetch ${key} with includeContext: true`, ctx);
    },
  });

  pi.registerCommand("get-jira-issue", {
    description: "Get a Jira issue by key",
    handler: async (args: string, ctx: { isIdle?: () => boolean }) => {
      const key = args.trim();
      if (!key) return;
      postPrompt(`Use jira_get_issue to fetch ${key}`, ctx);
    },
  });

  pi.registerCommand("story-context", {
    description: "Build implementation context from a Jira story",
    handler: async (args: string, ctx: { isIdle?: () => boolean }) => {
      const key = args.trim();
      if (!key) return;
      postPrompt(`Use story_context to build context for ${key}`, ctx);
    },
  });
}
