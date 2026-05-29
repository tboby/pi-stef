import path from "node:path";
import { PI_DIR, SF_NAMESPACE } from "./constants.js";

/** <root>/.pi/sf/<pkg>/ — e.g. .pi/sf/team/ */
export function projectDir(pkg: string, repoRoot: string): string {
  return path.join(repoRoot, PI_DIR, SF_NAMESPACE, pkg);
}

/** <root>/.pi/sf/<pkg>/config.json */
export function projectConfig(pkg: string, repoRoot: string): string {
  return path.join(projectDir(pkg, repoRoot), "config.json");
}
