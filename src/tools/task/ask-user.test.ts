import { describe, expect, it } from "vitest";
import { createAskUserTool, type UserQuestionRequest } from "./ask-user.js";

describe("ask_user tool", () => {
  it("keeps labeled options and descriptions, including null descriptions", async () => {
    let captured: UserQuestionRequest | undefined;
    const tool = createAskUserTool(async (request) => {
      captured = request;
      return { answers: { test1: "Não sei" }, cancelled: false };
    });

    const result = await tool.execute({
      title: "Teste da ferramenta",
      questions: [
        {
          id: "test1",
          header: "Teste",
          question: "Qual opção você escolhe para testar?",
          options: [
            { label: "Opção A", description: null },
            { label: "Opção B", description: "Escolha B" },
            "Opção antiga",
          ],
        },
      ],
    });

    expect(captured?.questions[0]?.options).toEqual([
      { label: "Opção A" },
      { label: "Opção B", description: "Escolha B" },
      { label: "Opção antiga" },
    ]);
    expect(result).toEqual({
      success: true,
      output: JSON.stringify({ answers: { test1: "Não sei" } }),
    });
  });

  it("supports multiple selection across separately paged questions", async () => {
    let captured: UserQuestionRequest | undefined;
    const tool = createAskUserTool(async (request) => {
      captured = request;
      return {
        answers: { languages: ["JavaScript / TypeScript", "Python"] },
        cancelled: false,
      };
    });

    const result = await tool.execute({
      title: "Preferências de desenvolvimento",
      questions: [
        {
          id: "languages",
          question: "Quais linguagens você usa?",
          selectionMode: "multiple",
          options: [
            { label: "JavaScript / TypeScript" },
            { label: "Python" },
            { label: "C# / .NET" },
          ],
        },
        {
          id: "editor",
          question: "Qual editor você prefere?",
          options: [{ label: "VS Code" }, { label: "Outro" }],
        },
      ],
    });

    expect(captured?.questions.map((question) => question.selectionMode)).toEqual([
      "multiple",
      undefined,
    ]);
    expect(captured?.questions).toHaveLength(2);
    expect(result.output).toBe(
      JSON.stringify({
        answers: { languages: ["JavaScript / TypeScript", "Python"] },
      }),
    );
  });

  it("advertises object choices and single/multiple selection modes", () => {
    const tool = createAskUserTool(async () => ({ answers: {}, cancelled: true }));
    const questionSchema = tool.parameters.properties?.questions?.items;
    const properties = questionSchema?.properties;
    const optionSchema = properties?.options?.items;

    expect(optionSchema).toMatchObject({
      type: "object",
      properties: {
        label: { type: "string" },
        description: { type: "string" },
      },
      required: ["label"],
    });
    expect(properties?.selectionMode).toMatchObject({
      type: "string",
      enum: ["single", "multiple"],
    });
  });
});
