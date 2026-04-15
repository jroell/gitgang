/**
 * Tiny terminal-markdown renderer for the orchestrator's bestAnswer.
 *
 * Intentionally minimal — it covers the markdown constructs that real
 * agent output actually uses (headers, bold, italic, inline + fenced
 * code, bullet/ordered lists, blockquotes, links) and ignores everything
 * else (tables, footnotes, HTML). All output is plain ANSI; no terminal
 * width detection, no word wrapping, no soft hyphens.
 *
 * Pure function — input string in, formatted string out.
 */

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
};

function wrap(text: string, code: string, on: boolean): string {
  return on ? `${code}${text}${ANSI.reset}` : text;
}

/**
 * Apply inline formatting to a single line: bold, italic, inline code, links.
 * Order matters: code first (so its contents aren't re-processed), then links,
 * then bold/italic.
 */
export function renderInline(line: string, color: boolean): string {
  // Inline code: `code` → cyan
  let out = line.replace(/`([^`]+)`/g, (_m, code: string) =>
    wrap(code, ANSI.cyan, color),
  );
  // Links: [text](url) → underline+cyan text (url dimmed in parens)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, url: string) =>
    wrap(text, ANSI.underline + ANSI.cyan, color) +
    wrap(` (${url})`, ANSI.dim, color),
  );
  // Bold: **text** → bold (do this BEFORE italic so the * inside ** isn't
  // matched as italic)
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, text: string) =>
    wrap(text, ANSI.bold, color),
  );
  // Italic: *text* → italic. Avoid matching ** by requiring no leading *.
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_m, pre: string, text: string) =>
    pre + wrap(text, ANSI.italic, color),
  );
  return out;
}

/**
 * Render a full markdown block-level document to ANSI.
 */
export function renderMarkdown(
  text: string,
  opts: { color: boolean } = { color: true },
): string {
  const c = opts.color;
  const lines = text.split("\n");
  const out: string[] = [];
  let inCodeFence = false;
  let codeFenceLang = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // Fenced code blocks: ```lang ... ```
    const fence = trimmed.match(/^```\s*(\S*)\s*$/);
    if (fence) {
      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceLang = fence[1];
        const header = codeFenceLang ? `┌─ ${codeFenceLang}` : "┌─";
        out.push(wrap(header, ANSI.dim, c));
      } else {
        inCodeFence = false;
        codeFenceLang = "";
        out.push(wrap("└─", ANSI.dim, c));
      }
      continue;
    }
    if (inCodeFence) {
      out.push(wrap("│ ", ANSI.dim, c) + wrap(line, ANSI.cyan, c));
      continue;
    }

    // Headers: # / ## / ### / ####
    const header = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (header) {
      const level = header[1].length;
      const content = renderInline(header[2], c);
      const prefix = level === 1 ? "▌ " : level === 2 ? "▎ " : "  ";
      const code = level <= 2 ? ANSI.bold + ANSI.cyan : ANSI.bold;
      out.push("");
      out.push(wrap(prefix + content, code, c));
      out.push("");
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      out.push(wrap("─".repeat(40), ANSI.dim, c));
      continue;
    }

    // Blockquote
    const blockquote = trimmed.match(/^>\s?(.*)$/);
    if (blockquote) {
      out.push(
        wrap("│ ", ANSI.magenta, c) + wrap(renderInline(blockquote[1], c), ANSI.dim, c),
      );
      continue;
    }

    // Bullet list
    const bullet = trimmed.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) {
      const indent = bullet[1];
      const content = renderInline(bullet[2], c);
      out.push(`${indent}${wrap("•", ANSI.cyan, c)} ${content}`);
      continue;
    }

    // Ordered list
    const numbered = trimmed.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numbered) {
      const indent = numbered[1];
      const num = numbered[2];
      const content = renderInline(numbered[3], c);
      out.push(`${indent}${wrap(`${num}.`, ANSI.cyan, c)} ${content}`);
      continue;
    }

    // Plain paragraph line — just inline processing
    out.push(renderInline(line, c));
  }

  // Close any unterminated code fence (defensive)
  if (inCodeFence) out.push(wrap("└─ (unterminated)", ANSI.dim, c));

  return out.join("\n");
}
