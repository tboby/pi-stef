const DEFAULT_SENSITIVE_KEYS = [
  "api_key",
  "apikey",
  "auth",
  "code",
  "jwt",
  "key",
  "passwd",
  "password",
  "secret",
  "session",
  "sig",
  "signature",
  "token",
];

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[),.;!?]+$/;

export function redactUrl(value: string, extraSensitiveKeys: string[] = []): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  url.username = "";
  url.password = "";

  const sensitiveKeys = new Set([...DEFAULT_SENSITIVE_KEYS, ...extraSensitiveKeys].map((key) => key.toLowerCase()));
  for (const key of [...url.searchParams.keys()]) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      url.searchParams.set(key, "REDACTED");
    }
  }

  return url.toString();
}

export function redactText(text: string, extraSensitiveKeys: string[] = []): string {
  const escapedKeys = [...DEFAULT_SENSITIVE_KEYS, ...extraSensitiveKeys].map(escapeRegExp);
  const sensitivePattern = new RegExp(`([?&](?:${escapedKeys.join("|")})=)[^\\s&]+`, "gi");
  return text.replace(URL_PATTERN, (match) => {
    const punctuation = match.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    const urlText = punctuation ? match.slice(0, -punctuation.length) : match;
    return `${redactUrl(urlText, extraSensitiveKeys)}${punctuation}`;
  }).replace(sensitivePattern, "$1REDACTED");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
