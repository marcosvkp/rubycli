import type { Tool } from "../base.js";

export interface UserQuestionOption {
  label: string;
  description?: string;
}

export type UserQuestionSelectionMode = "single" | "multiple";
export type UserQuestionAnswer = string | string[];

export interface UserQuestion {
  id: string;
  header?: string;
  question: string;
  options: UserQuestionOption[];
  /** Multiple questions are presented one per page. Omitted means single choice. */
  selectionMode?: UserQuestionSelectionMode;
}

export interface UserQuestionRequest {
  title: string;
  questions: UserQuestion[];
}

export interface UserQuestionResult {
  answers: Record<string, UserQuestionAnswer>;
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
      "Ask only what is needed, in one batch of one to three questions; each question is shown " +
      "as its own page. Include concise options as objects with a label and optional description. " +
      "Set selectionMode to 'multiple' when the human may choose more than one option; otherwise " +
      "omit it or use 'single'. A multiple-choice answer is returned as an array. The human can " +
      "also enter a custom answer. Wait for the result before proceeding.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short heading for the question card" },
        questions: {
          type: "array",
          description: "One to three questions for the human, shown one per page",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stable id for the answer in this batch" },
              header: { type: "string", description: "Short label shown above the question" },
              question: { type: "string", description: "The question to ask" },
              selectionMode: {
                type: "string",
                enum: ["single", "multiple"],
                description:
                  "Whether the human can select one option or multiple options; defaults to single",
              },
              options: {
                type: "array",
                description: "Optional selectable answers. Custom text is also allowed in the UI.",
                items: {
                  type: "object",
                  properties: {
                    label: {
                      type: "string",
                      description: "Short text shown on the selectable answer",
                    },
                    description: {
                      type: "string",
                      description: "Optional explanation shown beside the answer",
                    },
                  },
                  required: ["label"],
                },
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
              .flatMap((option): UserQuestionOption[] => {
                if (typeof option === "string") {
                  const label = option.trim();
                  return label ? [{ label: label.slice(0, 160) }] : [];
                }
                if (!option || typeof option !== "object" || Array.isArray(option)) return [];
                const optionRecord = option as Record<string, unknown>;
                if (typeof optionRecord.label !== "string") return [];
                const label = optionRecord.label.trim();
                if (!label) return [];
                const description =
                  typeof optionRecord.description === "string"
                    ? optionRecord.description.trim().slice(0, 300)
                    : "";
                return [
                  {
                    label: label.slice(0, 160),
                    ...(description ? { description } : {}),
                  },
                ];
              })
              .slice(0, 8)
          : [];
        const id = record.id;
        const header = record.header;
        const selectionMode = record.selectionMode === "multiple" ? "multiple" : undefined;
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
          ...(selectionMode ? { selectionMode } : {}),
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
