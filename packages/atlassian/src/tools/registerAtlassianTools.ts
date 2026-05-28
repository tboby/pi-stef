import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerConfluenceTools } from "../confluence/tools";
import { registerJiraSoftwareTools } from "../jira/softwareTools";
import { registerJiraPlatformTools } from "../jira/tools";

export function registerAtlassianTools(pi: ExtensionAPI): void {
  registerConfluenceTools(pi);
  registerJiraPlatformTools(pi);
  registerJiraSoftwareTools(pi);
}
