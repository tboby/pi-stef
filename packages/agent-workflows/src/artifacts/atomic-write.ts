import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function atomicWriteFile(filePath: string, body: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, filePath);
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
