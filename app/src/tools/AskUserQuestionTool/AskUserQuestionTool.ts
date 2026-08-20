/**
 * 用户提问工具 AskUserQuestionTool
 *
 * 支持三种提问类型（对齐设计方案 §5.2 PendingQuestion.type）：
 * - choice：封闭式多选题（提供 2-4 个固定选项）
 * - open：开放式确认（用户自由回答）
 * - confirm：是/否确认
 *
 * 交互机制：
 * - 流式路径（ReActToolLoop）：requiresUserInteraction → yield question → 等待 → _userAnswers 注入
 * - 非流式路径（TAORLoop）：_userAnswers 缺失时返回引导性错误，LLM 改用自然语言提问
 */
export interface AskUserQuestionInput {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect?: boolean;
  /** 提问类型（v0.5 新增，对齐 PendingQuestion.type） */
  questionType?: 'choice' | 'open' | 'confirm';
}

export interface AskUserQuestionResult {
  questionId: string;
  question: string;
  answers: string[];
  timestamp: number;
  /** 提问类型 */
  questionType: 'choice' | 'open' | 'confirm';
}

const questions: AskUserQuestionResult[] = [];

export function askUserQuestion(
  input: AskUserQuestionInput
): AskUserQuestionResult {
  const questionType = input.questionType ?? 'choice';
  const result: AskUserQuestionResult = {
    questionId: `q_${Date.now()}`,
    question: input.question,
    answers:
      input.questionType === 'open' || input.questionType === 'confirm'
        ? []
        : input.options.map((o) => o.label),
    timestamp: Date.now(),
    questionType,
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
import { getLogger } from '@modules/monitoring';

const logger = getLogger('tools:askUserQuestion');

export class AskUserQuestionTool extends BaseTool {
  name = 'ask_user_question';
  override description =
    '向用户提问以获取确认或决策。支持三种类型：\n' +
    '1. **choice**（默认）：封闭式多选题，提供 2-4 个固定选项。适用于选项可穷举的问题（如"选择技术栈"）。\n' +
    '2. **open**：开放式确认，用户自由回答。适用于无法穷举选项的问题（如"你的目标是什么？"）。\n' +
    '3. **confirm**：是/否确认。适用于需要用户批准的决策点（如"是否继续执行？"）。\n\n' +
    '**使用规范**：\n' +
    '- choice 类型：每个选项的 label 作为独立字段传入，不要写进 question 文本。\n' +
    '- open 类型：options 可传空数组或省略，系统会自动添加自由输入入口。\n' +
    '- confirm 类型：options 可传空数组或省略，系统自动生成"确认/取消"选项。\n' +
    '- 系统会在选项末尾自动添加"其它"选项，允许用户输入自由文本。';

  override tags = [ToolTag.AI];

  params: ToolParam[] = [
    {
      name: 'question',
      type: 'string',
      description:
        '简洁的问题描述（10-50 字）。仅作为问题标题，不要包含任何选项内容。',
      required: true,
      minLength: 2,
      maxLength: 200,
    },
    {
      name: 'header',
      type: 'string',
      description: '显示在面板顶部的简短分类标签（不超过 12 字）',
      required: true,
      minLength: 1,
      maxLength: 12,
    },
    {
      name: 'options',
      type: 'array',
      description:
        '选项数组，恰好 2-4 个项。每个项必须包含 label 和可选的 description。choice 类型必填；open/confirm 类型可省略或传空数组。',
      required: false,
      minLength: 0,
      maxLength: 4,
      items: {
        type: 'object',
        description: '单个选项的配置',
        properties: {
          label: {
            name: 'label',
            type: 'string',
            description:
              '选项显示文字（1-20 字）。所有选项的 label 必须各不相同。',
            required: true,
          },
          description: {
            name: 'description',
            type: 'string',
            description: '选项的补充说明（可选，最多 80 字）',
            required: false,
          },
        },
      },
    },
    {
      name: 'multiSelect',
      type: 'boolean',
      description: '是否允许多选。默认 false（单选）。仅 choice 类型有效。',
      required: false,
    },
    {
      name: 'questionType',
      type: 'string',
      description:
        '提问类型：choice（封闭式多选，默认）/ open（开放式确认）/ confirm（是/否确认）。',
      required: false,
    },
  ];

  override isReadOnly(): boolean {
    return true;
  }

  /**
   * 标记此工具需要用户交互
   * ChatManager.streamMessage() 检测到此标记后，
   * 会 yield question 分块到 UI 层并等待用户输入
   */
  override requiresUserInteraction(): boolean {
    return true;
  }

  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    _onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    const questionType = (input.questionType as string) ?? 'choice';
    const rawAnswers = input._userAnswers;
    const rawAnswersIsArray = Array.isArray(rawAnswers);
    const questionText = (input.question as string) ?? '';
    const options = (input.options as { label?: string }[]) ?? [];

    logger.info('ask_user_question:execute', {
      sessionId: context.sessionId,
      questionType,
      question: questionText.slice(0, 120),
      header: (input.header as string) ?? '',
      optionCount: options.length,
      multiSelect: input.multiSelect === true,
      hasUserAnswers: '_userAnswers' in input,
      answerCount: rawAnswersIsArray ? (rawAnswers as unknown[]).length : 0,
    });

    const userAnswers = rawAnswersIsArray ? (rawAnswers as string[]) : [];

    if (userAnswers.length === 0) {
      logger.warn('ask_user_question:no_answer', {
        sessionId: context.sessionId,
        questionType,
        question: questionText.slice(0, 120),
      });
      return createToolResult({
        error:
          '交互提问未完成：当前执行路径不支持等待用户回答（_userAnswers 缺失）。请改用自然语言在正文中直接提问，用户会在下一条消息中回复。',
        retryable: false,
      });
    }

    logger.info('ask_user_question:answered', {
      sessionId: context.sessionId,
      questionType,
      question: questionText.slice(0, 120),
      answerCount: userAnswers.length,
      answers: userAnswers.slice(0, 5),
    });

    const result: AskUserQuestionResult = {
      questionId: `q_${Date.now()}`,
      question: input.question as string,
      answers: userAnswers,
      timestamp: Date.now(),
      questionType: questionType as 'choice' | 'open' | 'confirm',
    };

    questions.push(result);

    return createToolResult(JSON.stringify(result, null, 2));
  }
}
