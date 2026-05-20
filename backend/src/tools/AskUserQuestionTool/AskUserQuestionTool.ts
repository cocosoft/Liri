/**
 * 用户提问工具 AskUserQuestionTool
 */
export interface AskUserQuestionInput {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect?: boolean;
}

export interface AskUserQuestionResult {
  questionId: string;
  question: string;
  answers: string[];
  timestamp: number;
}

const questions: AskUserQuestionResult[] = [];

export function askUserQuestion(
  input: AskUserQuestionInput
): AskUserQuestionResult {
  const result: AskUserQuestionResult = {
    questionId: `q_${Date.now()}`,
    question: input.question,
    answers: input.options.map((o) => o.label),
    timestamp: Date.now(),
  };
  questions.push(result);
  return result;
}

export function getQuestionHistory(): AskUserQuestionResult[] {
  return [...questions];
}

export function validateOptions(
  options: { label: string; description: string }[]
): {
  valid: boolean;
  reason?: string;
} {
  if (!options || options.length < 2) {
    return { valid: false, reason: 'At least 2 options required' };
  }
  if (options.length > 4) {
    return { valid: false, reason: 'Maximum 4 options allowed' };
  }
  return { valid: true };
}

import { BaseTool } from '../BaseTool';
import { ToolTag } from '../types/Tool';
import type {
  ToolParam,
  ToolUseContext,
  ToolCallProgress,
  ToolResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';

export class AskUserQuestionTool extends BaseTool {
  name = 'ask_user_question';
  description = 'Ask the user a question with multiple choice options';

  override tags = [ToolTag.AI];

  params: ToolParam[] = [
    {
      name: 'question',
      type: 'string',
      description: 'The question to ask the user',
      required: true,
    },
    {
      name: 'header',
      type: 'string',
      description: 'Short label displayed as a chip/tag',
      required: true,
    },
    {
      name: 'options',
      type: 'array',
      description: 'The available choices (2-4 options)',
      required: true,
    },
    {
      name: 'multiSelect',
      type: 'boolean',
      description: 'Allow multiple selections',
      required: false,
    },
  ];

  override isReadOnly(): boolean {
    return true;
  }

  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    const result = askUserQuestion({
      question: input.question as string,
      header: input.header as string,
      options: input.options as { label: string; description: string }[],
      multiSelect: input.multiSelect as boolean | undefined,
    });
    return createToolResult(JSON.stringify(result, null, 2));
  }
}
