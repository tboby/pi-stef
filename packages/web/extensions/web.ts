import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerWebAccess } from "../src/tools";

export default function webAccessExtension(pi: ExtensionAPI): void {
  registerWebAccess(pi);
}
