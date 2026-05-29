import path from "node:path";
import os from "node:os";
import { sfBase } from "./constants.js";

/** ~/.pi/sf/<pkg>/ — e.g. ~/.pi/sf/team/ */
export function globalDir(pkg: string, home?: string): string {
  return path.join(sfBase(home ?? os.homedir()), pkg);
}

/** ~/.pi/sf/<pkg>/config.json */
export function globalConfig(pkg: string, home?: string): string {
  return path.join(globalDir(pkg, home), "config.json");
}
