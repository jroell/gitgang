import { describe, test, expect } from "vitest";
import { renderMarkdown, renderInline } from "./markdown";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("renderInline", () => {
  test("inline code wrapped in backticks", () => {
    const out = renderInline("Use `npm install` to install.", true);
    expect(out).toContain("\x1b[36mnpm install\x1b[0m");
  });

  test("bold uses **", () => {
    const out = renderInline("This is **important** stuff.", true);
    expect(out).toContain("\x1b[1mimportant\x1b[0m");
  });

  test("italic uses single *", () => {
    const out = renderInline("This is *emphasized*.", true);
    expect(out).toContain("\x1b[3memphasized\x1b[0m");
  });

  test("bold inside text doesn't trigger italic", () => {
    const out = stripAnsi(renderInline("Use **bold** here, *italic* there.", true));
    expect(out).toContain("bold");
    expect(out).toContain("italic");
  });

  test("link renders text + dim url", () => {
    const out = renderInline("See [docs](https://x.com) for more.", true);
    expect(out).toContain("docs");
    expect(out).toContain("https://x.com");
  });

  test("color: false strips all formatting", () => {
    const out = renderInline("**bold** and `code` and *italic*", false);
    expect(out).toBe("bold and code and italic");
  });

  test("nested patterns: code containing asterisks is preserved", () => {
    const out = renderInline("Run `git log **/*.ts`", true);
    expect(out).toContain("git log **/*.ts");
  });

  test("multiple bold runs in one line", () => {
    const out = stripAnsi(renderInline("**one** and **two**", true));
    expect(out).toBe("one and two");
  });

  test("plain text passes through unchanged when color=false", () => {
    expect(renderInline("just plain text", false)).toBe("just plain text");
  });
});

describe("renderMarkdown — headers", () => {
  test("h1 with prefix marker and bold cyan", () => {
    const out = renderMarkdown("# Heading One", { color: true });
    expect(out).toContain("\x1b[1m\x1b[36m");
    expect(out).toContain("Heading One");
  });

  test("h1, h2, h3 use different prefix markers", () => {
    const h1 = stripAnsi(renderMarkdown("# H1", { color: true }));
    const h2 = stripAnsi(renderMarkdown("## H2", { color: true }));
    const h3 = stripAnsi(renderMarkdown("### H3", { color: true }));
    expect(h1).toContain("▌ H1");
    expect(h2).toContain("▎ H2");
    expect(h3).toContain("  H3");
  });

  test("headers add blank lines above and below", () => {
    const out = stripAnsi(renderMarkdown("# Title", { color: true }));
    const lines = out.split("\n");
    expect(lines[0]).toBe("");
    expect(lines[1]).toContain("Title");
    expect(lines[2]).toBe("");
  });

  test("headers process inline formatting in their text", () => {
    const out = stripAnsi(renderMarkdown("# **bold** word", { color: true }));
    expect(out).toContain("bold word");
  });
});

describe("renderMarkdown — fenced code blocks", () => {
  test("renders fenced code with language label", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const out = stripAnsi(renderMarkdown(md, { color: true }));
    expect(out).toContain("┌─ typescript");
    expect(out).toContain("│ const x = 1;");
    expect(out).toContain("└─");
  });

  test("renders fenced code without language", () => {
    const md = "```\nplain text\n```";
    const out = stripAnsi(renderMarkdown(md, { color: true }));
    expect(out).toContain("┌─");
    expect(out).toContain("│ plain text");
  });

  test("preserves multi-line code block content verbatim", () => {
    const md = "```\nline 1\nline 2\nline 3\n```";
    const out = stripAnsi(renderMarkdown(md, { color: true }));
    expect(out).toContain("│ line 1");
    expect(out).toContain("│ line 2");
    expect(out).toContain("│ line 3");
  });

  test("inline code inside a fence is NOT re-processed (literal backticks)", () => {
    const md = "```\nuse `foo` here\n```";
    const out = stripAnsi(renderMarkdown(md, { color: true }));
    expect(out).toContain("│ use `foo` here");
  });

  test("unterminated fence emits a (unterminated) trailer", () => {
    const md = "```ts\nlet x = 1\n";
    const out = stripAnsi(renderMarkdown(md, { color: true }));
    expect(out).toContain("(unterminated)");
  });
});

describe("renderMarkdown — lists", () => {
  test("bullet list: -, *, + all recognized", () => {
    expect(stripAnsi(renderMarkdown("- one", { color: true }))).toContain("• one");
    expect(stripAnsi(renderMarkdown("* two", { color: true }))).toContain("• two");
    expect(stripAnsi(renderMarkdown("+ three", { color: true }))).toContain("• three");
  });

  test("ordered list preserves number", () => {
    const out = stripAnsi(renderMarkdown("1. first\n2. second\n10. tenth", { color: true }));
    expect(out).toContain("1. first");
    expect(out).toContain("2. second");
    expect(out).toContain("10. tenth");
  });

  test("nested bullet preserves indentation", () => {
    const out = stripAnsi(renderMarkdown("- outer\n  - inner", { color: true }));
    expect(out).toContain("• outer");
    expect(out).toContain("  • inner");
  });

  test("list items process inline formatting", () => {
    const out = stripAnsi(renderMarkdown("- use `git commit`", { color: true }));
    expect(out).toContain("• use git commit");
  });
});

describe("renderMarkdown — blockquote", () => {
  test("blockquote line gets vertical bar", () => {
    const out = stripAnsi(renderMarkdown("> wisdom", { color: true }));
    expect(out).toContain("│ wisdom");
  });

  test("blockquote inline formatting works", () => {
    const out = stripAnsi(renderMarkdown("> see `code`", { color: true }));
    expect(out).toContain("│ see code");
  });
});

describe("renderMarkdown — horizontal rule", () => {
  test("--- becomes dim line", () => {
    const out = stripAnsi(renderMarkdown("---", { color: true }));
    expect(out).toContain("─".repeat(40));
  });

  test("*** also becomes hr", () => {
    const out = stripAnsi(renderMarkdown("***", { color: true }));
    expect(out).toContain("─".repeat(40));
  });
});

describe("renderMarkdown — composite", () => {
  test("realistic mixed-content snippet renders without error", () => {
    const md = [
      "# Auth Overview",
      "",
      "Authentication uses **passport.js** with three strategies:",
      "",
      "1. OAuth2 (Google, GitHub)",
      "2. JWT for API access",
      "3. Session cookies for the web app",
      "",
      "## Implementation",
      "",
      "The middleware lives in `src/auth/middleware.ts`:",
      "",
      "```typescript",
      "export const requireAuth = (req, res, next) => {",
      "  if (!req.user) return res.status(401).end();",
      "  next();",
      "};",
      "```",
      "",
      "> Note: the JWT strategy was added in v2.1.",
      "",
      "See [the docs](https://example.com) for setup.",
    ].join("\n");
    const out = renderMarkdown(md, { color: true });
    const stripped = stripAnsi(out);
    expect(stripped).toContain("Auth Overview");
    expect(stripped).toContain("passport.js");
    expect(stripped).toContain("1. OAuth2");
    expect(stripped).toContain("│ export const requireAuth");
    expect(stripped).toContain("│ Note: the JWT strategy was added in v2.1.");
    expect(stripped).toContain("https://example.com");
  });

  test("color: false produces plain text with no ANSI codes", () => {
    const md = "# Title\n\n**Bold** and `code` and a [link](https://x).";
    const out = renderMarkdown(md, { color: false });
    expect(out).not.toContain("\x1b[");
    expect(out).toContain("Title");
    expect(out).toContain("Bold");
    expect(out).toContain("code");
    expect(out).toContain("https://x");
  });

  test("empty input produces empty output", () => {
    expect(renderMarkdown("", { color: true })).toBe("");
  });

  test("trailing newline preserved", () => {
    const out = renderMarkdown("plain\n", { color: false });
    expect(out).toBe("plain\n");
  });
});
