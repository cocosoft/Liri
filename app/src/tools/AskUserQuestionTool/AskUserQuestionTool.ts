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
import { getLogger } from '@modules/monitoring';

/** 提问工具排查日志（2026-08-14 第五十次）：观察 LLM 是否调用、调用内容、答案是否注入 */
const logger = getLogger('tools:askUserQuestion');

export class AskUserQuestionTool extends BaseTool {
  name = 'ask_user_question';
  override description =
    '向用户提出一个封闭式多选题（提供 2-4 个固定选项）。**此工具仅适用于选项可以穷举的问题（如"选择技术栈"、"选择模式"）**，不适用于开放性问题（如"你的目标是什么？"、"有什么想法？"）。' +
    '对于开放性问题，请直接在正文中以自然语言提问，让用户自由回答，不要调用此工具。' +
    '**严禁**将所有选项内容直接写进 question 文本中，每个选项的具体文字必须作为独立对象的 label 字段传入。' +
    'question 字段只能是简洁的问题标题（如"请选择参与方式"），选项细节放在 options 数组中。' +
    '系统会在选项末尾自动添加"其它"选项，允许用户输入自由文本。';

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
        '选项数组，恰好 2-4 个项。每个项必须包含 label（选项文字，1-20 字）和可选的 description（补充说明）',
      required: true,
      minLength: 2,
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
      description: '是否允许多选。默认 false（单选）',
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
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    // 优先使用 ChatManager 注入的用户真实答案（来自 UI 层的选择）
    // 如果没有 _userAnswers，说明工具调用走的非交互路径（未经过 streamMessage 的交互检查）
    // 此时返回空数组，不允许自动回退到全部选项（避免"自我回答"问题）
    const userAnswers = (input._userAnswers as string[]) || [];

    // 提问工具调用日志（2026-08-14 第五十次补充）：记录 LLM 是否发起提问、问题内容、
    // 选项数、是否收到用户答案——观察"提问工具不能正常调用/结果未返回"类问题的关键路径
    const questionText = (input.question as string) ?? '';
    const options = (input.options as { label?: string }[]) ?? [];
    if (userAnswers.length > 0) {
      logger.info('ask_user_question:answered', {
        sessionId: context.sessionId,
        question: questionText.slice(0, 120),
        header: (input.header as string) ?? '',
        optionCount: options.length,
        answerCount: userAnswers.length,
        answers: userAnswers.slice(0, 5),
      });
    } else {
      // 无用户答案：可能是未走交互路径（LLM 调用被 abort/未等答案）、或答案注入失败。
      // 05-1 排查关注点：此日志出现即说明提问被发起但答案未回灌，需结合前端 QuestionBlock
      // 是否展示定位。
      logger.warn('ask_user_question:no_answer', {
        sessionId: context.sessionId,
        question: questionText.slice(0, 120),
        header: (input.header as string) ?? '',
        optionCount: options.length,
        hasUserAnswersField: '_userAnswers' in input,
      });
    }

    const result: AskUserQuestionResult = {
      questionId: `q_${Date.now()}`,
      question: input.question as string,
      answers: userAnswers,
      timestamp: Date.now(),
    };

    // 记录到历史（仅当有真实答案时）
    if (userAnswers.length > 0) {
      questions.push(result);
    }

    return createToolResult(JSON.stringify(result, null, 2));
  }
}
