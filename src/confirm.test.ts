import { describe, test, expect } from "vitest";
import { PassThrough } from "node:stream";
import { promptMergeConfirm } from "./confirm";

function makeIo() {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (c) => chunks.push(c));
  return {
    input,
    output,
    text: () => Buffer.concat(chunks).toString("utf8"),
  };
}

describe("promptMergeConfirm", () => {
  test("returns 'yes' for y", async () => {
    const { input, output } = makeIo();
    const p = promptMergeConfirm(input, output);
    input.write("y\n");
    input.end();
    expect(await p).toBe("yes");
  });

  test("returns 'yes' for Y", async () => {
    const { input, output } = makeIo();
    const p = promptMergeConfirm(input, output);
    input.write("Y\n");
    input.end();
    expect(await p).toBe("yes");
  });

  test("returns 'no' for n", async () => {
    const { input, output } = makeIo();
    const p = promptMergeConfirm(input, output);
    input.write("n\n");
    input.end();
    expect(await p).toBe("no");
  });

  test("returns 'no' for empty (default)", async () => {
    const { input, output } = makeIo();
    const p = promptMergeConfirm(input, output);
    input.write("\n");
    input.end();
    expect(await p).toBe("no");
  });

  test("returns 'edit' for e", async () => {
    const { input, output } = makeIo();
    const p = promptMergeConfirm(input, output);
    input.write("e\n");
    input.end();
    expect(await p).toBe("edit");
  });

  test("re-prompts on invalid input", async () => {
    const { input, output, text } = makeIo();
    const p = promptMergeConfirm(input, output);
    input.write("maybe\n");
    input.write("y\n");
    input.end();
    expect(await p).toBe("yes");
    expect(text()).toMatch(/please answer y, n, or e/i);
  });
});
