import type { Tool } from "../base.js";

export interface UserQuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  id: string;
  header?: string;
  question: string;
  options: UserQuestionOption[];
}

export interface UserQuestionRequest {
  title: string;
  questions: UserQuestion[];
}

export interface UserQuestionResult {
  answers: Record<string, string>;
  cancelled: boolean;
}

/** Host callback used by graphical shells to pause a turn for a human answer. */
export type AskUserFn = (request: UserQuestionRequest) => Promise<UserQuestionResult>;

/** Creates the structured ask-user tool without coupling the engine to a UI. */
export function createAskUserTool(askUser?: AskUserFn): Tool {
  return {
    name: "ask_user",
    readonly: true,
    description:
      "Ask the human a structured clarification question when a decision blocks progress. " +
      "Ask only what is needed, in one batch of at most three questions. Include concise options " +
      "when useful; the human can also enter a custom answer. Wait for the result before proceeding.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short heading for the question card" },
        questions: {
          type: "array",
          description: "One to three questions for the human",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stable id for the answer in this batch" },
              header: { type: "string", description: "Short label shown above the question" },
              question: { type: "string", description: "The question to ask" },
              options: {
                type: "array",
                description: "Optional selectable answers; custom text is always allowed",
                items: { type: "string" },
              },
            },
            required: ["question"],
          },
        },
      },
      required: ["questions"],
    },
    async execute(params) {
      if (!askUser) {
        return {
          success: false,
          output: "",
          error: "User questions are not configured in this environment.",
        };
      }

      const rawQuestions = params.questions;
      if (!Array.isArray(rawQuestions) || rawQuestions.length < 1 || rawQuestions.length > 3) {
        return { success: false, output: "", error: "Provide between one and three questions." };
      }

      const questions: UserQuestion[] = [];
      const usedIds = new Set<string>();
      for (const [index, raw] of rawQuestions.entries()) {
        if (!raw || typeof raw !== "object") {
          return { success: false, output: "", error: "Question " + (index + 1) + " is invalid." };
        }
        const record = raw as Record<string, unknown>;
        const question = record.question;
        if (typeof question !== "string" || !question.trim()) {
          return {
            success: false,
            output: "",
            error: "Question " + (index + 1) + " must contain text.",
          };
        }
        const rawOptions = record.options;
        const options = Array.isArray(rawOptions)
          ? rawOptions
              .filter((option): option is string => typeof option === "string")
              .slice(0, 8)
              .map((label) => ({ label: label.slice(0, 160) }))
          : [];
        const id = record.id;
        const header = record.header;
        const baseId = typeof id === "string" && id.trim() ? id.slice(0, 80) : "q" + (index + 1);
        let uniqueId = baseId;
        let suffix = 2;
        while (usedIds.has(uniqueId)) uniqueId = `${baseId.slice(0, 72)}_${suffix++}`;
        usedIds.add(uniqueId);
        questions.push({
          id: uniqueId,
          ...(typeof header === "string" && header.trim() ? { header: header.slice(0, 80) } : {}),
          question: question.trim().slice(0, 3000),
          options,
        });
      }

      const request: UserQuestionRequest = {
        title:
          typeof params.title === "string" && params.title.trim()
            ? params.title.trim().slice(0, 120)
            : "Pergunta do agente",
        questions,
      };
      const result = await askUser(request);
      if (result.cancelled) {
        return {
          success: true,
          output: "The human cancelled this question. Continue accordingly.",
        };
      }
      return { success: true, output: JSON.stringify({ answers: result.answers }) };
    },
  };
}
