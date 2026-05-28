import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerFhTeam } from "../src/register";

export default function fhTeamExtension(pi: ExtensionAPI): void {
  registerFhTeam(pi);
}
