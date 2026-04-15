import { createInterface } from "node:readline";

export type MergeChoice = "yes" | "no" | "edit";

export async function promptMergeConfirm(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<MergeChoice> {
  const rl = createInterface({ input, output, terminal: false });

  for await (const line of rl) {
    const answer = line.trim().toLowerCase();
    if (answer === "y" || answer === "yes") {
      rl.close();
      return "yes";
    }
    if (answer === "" || answer === "n" || answer === "no") {
      rl.close();
      return "no";
    }
    if (answer === "e" || answer === "edit") {
      rl.close();
      return "edit";
    }
    output.write("Please answer y, n, or e (default n): ");
  }
  return "no";
}
