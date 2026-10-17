import type { Tool } from "../tools/base.js";
import type { ToolDefinition } from "./types.js";

export function toolToDefinition(tool: Tool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as unknown as Record<string, unknown>,
  };
}

export const activateSkillDefinition: ToolDefinition = {
  name: "activate_skill",
  description:
    "Activate a skill to load its instructions into the conversation context. Use this when a user's request matches a known skill.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name of the skill to activate",
      },
    },
    required: ["name"],
  },
};

export const readSkillsDefinition: ToolDefinition = {
  name: "read_skills",
  description:
    "Search the already-loaded skill catalog and read matching full SKILL.md instructions in one call. Use this instead of globbing or shell-searching for skill files. The result is read-only: embedded !{shell} preprocessors are shown as text and never executed. Set limit to 32 when the user asks for all skills in a topic; use activate_skill afterward for one selected skill when activation-time project context is needed.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Topic, technology, skill name, or phrase to search in skill names and descriptions",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 32,
        description:
          "Maximum number of matching skills to read (default 8; use 32 to read a whole skill family)",
      },
    },
    required: ["query"],
  },
};
