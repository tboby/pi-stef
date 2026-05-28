export interface AdfDoc {
  type: "doc";
  version: 1;
  content: AdfNode[];
}

export type AdfNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
};

export function plainTextToAdf(value: string): AdfDoc {
  const paragraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return {
    type: "doc",
    version: 1,
    content: (paragraphs.length ? paragraphs : [""]).map((paragraph) => ({
      type: "paragraph",
      content: paragraphToContent(paragraph),
    })),
  };
}

export function textOrAdfToAdf(value: string | unknown): unknown {
  return typeof value === "string" ? plainTextToAdf(value) : value;
}

export function adfToPlainText(value: unknown): string {
  return normalizeWhitespace(renderAdfNode(value));
}

function paragraphToContent(value: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  const lines = value.split(/\n/);
  for (const [index, line] of lines.entries()) {
    if (index > 0) nodes.push({ type: "hardBreak" });
    if (line) nodes.push({ type: "text", text: line });
  }
  return nodes;
}

function renderAdfNode(value: unknown): string {
  if (!isRecord(value)) return "";

  const type = typeof value.type === "string" ? value.type : "";
  const children = childContent(value).map(renderAdfNode).join("");

  switch (type) {
    case "doc":
      return childContent(value).map(renderAdfNode).join("\n");
    case "paragraph":
      return `${children}\n`;
    case "heading": {
      const level = attrs(value).level;
      const depth = typeof level === "number" ? Math.min(Math.max(level, 1), 6) : 2;
      return `${"#".repeat(depth)} ${children.trim()}\n`;
    }
    case "text":
      return typeof value.text === "string" ? value.text : "";
    case "hardBreak":
      return "\n";
    case "bulletList":
    case "orderedList":
      return `${childContent(value).map(renderAdfNode).join("")}\n`;
    case "listItem":
      return `- ${children.trim()}\n`;
    case "blockquote":
      return children
        .split("\n")
        .filter(Boolean)
        .map((line) => `> ${line}`)
        .join("\n");
    case "codeBlock":
      return `\n\`\`\`\n${children.trim()}\n\`\`\`\n`;
    case "panel":
      return `\n${children.trim()}\n`;
    case "inlineCard":
    case "blockCard": {
      const url = attrs(value).url;
      return typeof url === "string" ? url : children;
    }
    case "mention": {
      const text = attrs(value).text;
      return typeof text === "string" ? text : children;
    }
    default:
      return children;
  }
}

function normalizeWhitespace(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function childContent(node: Record<string, unknown>): unknown[] {
  return Array.isArray(node.content) ? node.content : [];
}

function attrs(node: Record<string, unknown>): Record<string, unknown> {
  return isRecord(node.attrs) ? node.attrs : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
