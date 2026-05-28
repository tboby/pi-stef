import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { truncateHead } from "@earendil-works/pi-coding-agent";

import type { TruncatedText } from "./types";

export interface TextOutputOptions {
  filePrefix?: string;
  maxBytes: number;
  maxLines: number;
  outputDir: string;
}

export async function createTextOutput(text: string, options: TextOutputOptions): Promise<TruncatedText> {
  const truncated = truncateHead(text, {
    maxBytes: options.maxBytes,
    maxLines: options.maxLines,
  });

  let fullOutputPath: string | undefined;
  if (truncated.truncated) {
    await mkdir(options.outputDir, { recursive: true });
    const fileName = `${sanitizeFilePrefix(options.filePrefix ?? "web-output")}-${randomUUID()}.txt`;
    fullOutputPath = path.join(options.outputDir, fileName);
    await writeFile(fullOutputPath, text);
  }

  return {
    fullOutputPath,
    originalBytes: truncated.totalBytes,
    returnedBytes: truncated.outputBytes,
    text: truncated.content,
    truncated: truncated.truncated,
  };
}

function sanitizeFilePrefix(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "web-output";
}
