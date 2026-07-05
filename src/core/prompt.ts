import type { Charter, Item } from "../spec/types.js";
import type { RunState } from "./state.js";

export function buildStepPrompt(item: Item, charter: Charter, _state: RunState): string {
  return [
    `Task: ${item.description}`,
    ``,
    `CONSTRAINTS (strictly enforced):`,
    `- Edit ONLY files in: ${item.scope.include.join(", ")}`,
    `- Do NOT run shell commands, tests, or build tools`,
    `- Do NOT edit any other files`,
    `- Make the minimal change and stop`,
    `- Return immediately after editing`,
    ``,
    `Context: ${charter.goal}`,
  ].join("\n");
}
