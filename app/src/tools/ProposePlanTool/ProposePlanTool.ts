/**
 * 执行计划工具 ProposePlanTool
 *
 * M3-T3.1（2026-08-31）：AI 提交执行计划 → 用户批准/驳回 → 批准后继续执行。
 *
 * 交互机制（复用 ask_user_question 的 question 通道）：
 * - 流式路径（ReActToolLoop）：requiresUserInteraction → yield question（options:
 *   批准/驳回）→ 用户选择 → _userAnswers 注入 → execute 返回批准/驳回结果。
 * - 计划内容在 question 文本中，经 assistant/question 事件落盘（events.jsonl 可回放）。
 * - 非流式路径（TAORLoop）：_userAnswers 缺失时返回引导性错误，LLM 改用自然语言。
 *
 * 对齐 openworker plan_approver：计划提交 → 等待决策 → 批准后同会话继续执行（上下文不丢）。
 */
export interface ProposePlanInput {
  /** 计划标题（≤ 20 字） */
  header: string;
  /** 计划内容（多行步骤描述，即 question 文本） */
  question: string;
  /** 计划详情（可选，展示在 question 文本后） */
  plan?: Array<{ step: string; detail?: string }>;
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

const logger = getLogger('tools:proposePlan');

export class ProposePlanTool extends BaseTool {
  name = 'propose_plan';
  override description =
    '提交一份执行计划并等待用户批准。适用于高风险写操作（批量删除/外发/大规模改动）' +
    '或需要用户确认方向的场景。\n\n' +
    '**使用规范**：\n' +
    '- header：计划标题（如"批量删除计划"），不超过 20 字。\n' +
    '- question：计划内容，用多行列出具体执行步骤（每步做什么、影响什么），用户据此决策。\n' +
    '- plan：可选，结构化步骤数组（step + detail），会追加展示。\n' +
    '- options：**必填**，固定为 [{"label":"批准","description":"同意并继续执行"},{"label":"驳回","description":"拒绝并让 AI 调整"}]。\n' +
    '- 用户批准后系统自动继续执行；驳回后可参考回复调整计划后重新提交。';

  override tags = [ToolTag.AI];

  params: ToolParam[] = [
    {
      name: 'header',
      type: 'string',
      description: '计划标题（不超过 20 字），如"批量删除计划"',
      required: true,
      minLength: 1,
      maxLength: 20,
    },
    {
      name: 'question',
      type: 'string',
      description:
        '计划内容：多行列出具体执行步骤（每步做什么、影响什么），用户据此批准或驳回。',
      required: true,
      minLength: 2,
    },
    {
      name: 'options',
      type: 'array',
      description:
        '必填：固定为 [{label:"批准"},{label:"驳回"}]，用户据此选择。不要传其它选项。',
      required: true,
      maxLength: 2,
      items: {
        type: 'object',
        description: '审批选项（批准/驳回）',
        properties: {
          label: {
            name: 'label',
            type: 'string',
            description: '选项文字：批准 或 驳回',
            required: true,
          },
          description: {
            name: 'description',
            type: 'string',
            description: '选项补充说明',
            required: false,
          },
        },
      },
    },
    {
      name: 'plan',
      type: 'array',
      description:
        '可选：结构化步骤数组，每项含 step（步骤描述）与 detail（可选补充）。',
      required: false,
      items: {
        type: 'object',
        description: '单个执行步骤',
        properties: {
          step: {
            name: 'step',
            type: 'string',
            description: '步骤描述',
            required: true,
          },
          detail: {
            name: 'detail',
            type: 'string',
            description: '步骤补充说明（可选）',
            required: false,
          },
        },
      },
    },
  ];

  override isReadOnly(): boolean {
    return true;
  }

  /** 标记此工具需要用户交互——ReActToolLoop yield question 卡等待批准/驳回 */
  override requiresUserInteraction(): boolean {
    return true;
  }

  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    _onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    const rawAnswers = input._userAnswers;
    const answers = Array.isArray(rawAnswers) ? (rawAnswers as string[]) : [];
    const planText = (input.question as string) ?? '';
    const planDetail =
      (input.plan as Array<{ step: string; detail?: string }>) ?? [];

    logger.info('propose_plan:execute', {
      sessionId: context.sessionId,
      header: (input.header as string) ?? '',
      planLength: planText.length,
      stepCount: planDetail.length,
      hasUserAnswers: '_userAnswers' in input,
      answerCount: answers.length,
    });

    if (answers.length === 0) {
      logger.warn('propose_plan:no_answer', {
        sessionId: context.sessionId,
        header: (input.header as string) ?? '',
      });
      return createToolResult({
        error:
          '计划审批未完成：当前执行路径不支持等待用户批准（_userAnswers 缺失）。' +
          '请改用自然语言在正文中提交计划，用户会在下一条消息中回复是否批准。',
        retryable: false,
      });
    }

    const decision = answers[0];
    if (decision === '驳回' || decision === '拒绝' || decision === '取消') {
      logger.info('propose_plan:rejected', {
        sessionId: context.sessionId,
        header: (input.header as string) ?? '',
      });
      return createToolResult(
        JSON.stringify(
          {
            status: 'rejected',
            message:
              '计划被用户驳回。请根据用户反馈调整计划后重新提交，或改问用户修改意见。',
            header: input.header,
            plan: planText,
          },
          null,
          2
        )
      );
    }

    logger.info('propose_plan:approved', {
      sessionId: context.sessionId,
      header: (input.header as string) ?? '',
    });
    return createToolResult(
      JSON.stringify(
        {
          status: 'approved',
          message:
            '计划已获用户批准，请严格按照以下计划继续执行，不要遗漏或跳过任何步骤。',
          header: input.header,
          plan: planText,
          steps: planDetail,
        },
        null,
        2
      )
    );
  }
}

/** 创建执行计划工具实例 */
export function createProposePlanTool(): ProposePlanTool {
  return new ProposePlanTool();
}
