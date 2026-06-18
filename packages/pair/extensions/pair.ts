import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSfPair } from "../src/register";

export default function pairExtension(pi: ExtensionAPI): void {
  registerSfPair(pi);
}
