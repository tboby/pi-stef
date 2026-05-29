export const MAX_GUIDANCE_TEXT_LENGTH = 2000;
export const MAX_INJECTED_GUIDANCE_CHARS = 4000;

// Strip every ASCII control character except `\t` (\x09) and `\n` (\x0A).
// `\r` (\x0D) is explicitly included in the stripped set so the rendered
// guidance section uses only `\n` line breaks — the injection formatter
// splits on `\n` to repeat the provenance prefix on every continuation
// line, so a stray `\r` separator would otherwise produce an unprefixed
// line in the rendered prompt.
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B-\x1F\x7F]/g;
const ZERO_WIDTH_REGEX = /[​-‏‪-‮⁠-⁯﻿]/g;

export function sanitizeGuidanceText(text: string): string {
  return text
    .replace(CONTROL_CHAR_REGEX, "")
    .replace(ZERO_WIDTH_REGEX, "");
}

export function truncateGuidanceText(text: string, max = MAX_GUIDANCE_TEXT_LENGTH): string {
  const sanitized = sanitizeGuidanceText(text);
  if (sanitized.length <= max) return sanitized;
  return `${sanitized.slice(0, max)}…[truncated]`;
}
