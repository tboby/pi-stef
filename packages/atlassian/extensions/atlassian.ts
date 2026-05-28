import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAtlassianTools } from "../src/tools/registerAtlassianTools";

export default function atlassianExtension(pi: ExtensionAPI): void {
  registerAtlassianTools(pi);
}
