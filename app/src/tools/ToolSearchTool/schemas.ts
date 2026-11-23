import { z } from 'zod';

/**
 * ToolSearchTool 输入模式
 */
export const ToolSearchInputSchema = z.strictObject({
  query: z
    .string()
    .min(1)
    .describe(
      '搜索查询。使用 "select:<tool_name>" 进行直接选择，或使用关键词搜索已注册的工具（含延迟加载与因本轮任务裁剪而不可见的工具）'
    ),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('最大返回结果数，默认为 5'),
});

/**
 * 命中工具的**可读详情**（2026-11-23：回应「只回名字、不回结构」的实测痛点）。
 *
 * `description` 截断到固定长度（长描述如 `agent` 近 3.5k 字符，全量下发会挤占窗口）。
 */
export const ToolSearchDetailSchema = z.object({
  name: z.string().describe('工具名'),
  description: z
    .string()
    .describe('工具描述（超长截断，用于确认是否为目标工具）'),
  requiredParams: z.array(z.string()).describe('必填参数名（按声明顺序）'),
  requiredAnyOf: z
    .array(z.array(z.string()))
    .optional()
    .describe(
      '条件必填（OR-of-ANDs）：每组内参数需同时提供，至少满足一组（如 doc_generate 的 content|content_file）'
    ),
  requiredByOp: z
    .record(z.string(), z.array(z.array(z.string())))
    .optional()
    .describe(
      '条件必填（按判别字段取值）：键为 action/op 的取值（如 pdf 的 generate/extract）'
    ),
  /**
   * 2026-11-23（会话复测）：族工具（`vfs`/`cron`/`skill`/`sleep`/`worktree`/`task_list`）的
   * 判别字段（`op`/`mode`/`action`）在 schema 里 `required: false`（兼容旧名调用）⇒
   * `requiredParams` 会为空。这里显式带出判别字段与合法取值，避免"完全无法调用"。
   */
  opParam: z
    .object({
      name: z.string().describe('判别字段名（op / mode / action）'),
      values: z.array(z.string()).describe('合法取值'),
    })
    .optional()
    .describe('族工具的判别字段与合法取值（缺省 = 非族工具）'),
  /**
   * 2026-11-23（会话复测 P3）：原名 `visible` 被误读为"能否调用"⇒ 正名为
   * `autoDisclosed`：只表示**本轮是否自动下发**（预算/任务裁剪影响自动下发，
   * 但多数情况下仍可按名/select 调用；具体见 `notAutoDisclosedHint`）。
   */
  autoDisclosed: z
    .boolean()
    .describe(
      '是否在本轮自动下发的工具清单中；false ≠ 不可调用（预算/任务裁剪时仍可按名调用，见 notAutoDisclosedHint）'
    ),
  notAutoDisclosedReasons: z
    .array(z.string())
    .describe('未自动下发的原因码（自动下发时为空数组）'),
  notAutoDisclosedHint: z
    .string()
    .optional()
    .describe(
      '未自动下发原因的中文解释，并明确「是否仍可按名调用」（自动下发时缺省）'
    ),
});

/** 未命中项的**结构化原因**（`tool_search` 空结果不再"零诊断"） */
export const ToolSearchDiagnosticSchema = z.object({
  name: z.string().describe('被查询但未命中的名字'),
  reason: z
    .enum([
      'not_registered',
      'declared_unregistered',
      'archived',
      'capability_gated',
      'feature_gate_off',
      'task_filtered',
      'alias',
    ])
    .describe('未命中原因'),
  hint: z.string().optional().describe('处置建议（如何拿到该能力）'),
});

/**
 * ToolSearchTool 输出模式
 */
export const ToolSearchOutputSchema = z.object({
  matches: z.array(z.string()).describe('匹配的工具名称列表'),
  query: z.string().describe('原始查询字符串'),
  total_deferred_tools: z.number().describe('延迟加载工具的总数'),
  deferredToolNames: z
    .array(z.string())
    .describe(
      '延迟加载工具的完整名称列表（用于区分关键词未命中 vs 工具不存在）'
    ),
  details: z
    .array(ToolSearchDetailSchema)
    .optional()
    .describe('命中工具详情（描述 / 必填参数 / 本轮可见性）'),
  diagnostics: z
    .array(ToolSearchDiagnosticSchema)
    .optional()
    .describe('未命中项的结构化原因（select: 与关键词分支共用）'),
  reason: z
    .string()
    .optional()
    .describe(
      '未命中的主原因：select: 分支等价 diagnostics[0].reason；关键词分支无已知名时固定为 no_keyword_match'
    ),
  hint: z.string().optional().describe('未命中的主处置建议'),
});

export type ToolSearchInput = z.infer<typeof ToolSearchInputSchema>;
export type ToolSearchOutput = z.infer<typeof ToolSearchOutputSchema>;
export type ToolSearchDetail = z.infer<typeof ToolSearchDetailSchema>;
export type ToolSearchDiagnostic = z.infer<typeof ToolSearchDiagnosticSchema>;

/**
 * U-03（2026-10-19）：`tool_search` 的**模型可见出参结构**（JSON Schema），
 * 与 `ToolSearchOutputSchema` 逐字段对齐（改 zod 须同步，用例做键集断言）。
 */
export const ToolSearchOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: { type: 'string' },
      description: '匹配的工具名称列表',
    },
    query: { type: 'string', description: '原始查询字符串' },
    total_deferred_tools: { type: 'number', description: '延迟加载工具的总数' },
    deferredToolNames: {
      type: 'array',
      items: { type: 'string' },
      description:
        '延迟加载工具的完整名称列表（用于区分关键词未命中 vs 工具不存在）',
    },
    details: {
      type: 'array',
      description: '命中工具详情（描述 / 必填参数 / 本轮可见性）',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '工具名' },
          description: {
            type: 'string',
            description: '工具描述（超长截断，用于确认是否为目标工具）',
          },
          requiredParams: {
            type: 'array',
            items: { type: 'string' },
            description: '必填参数名（按声明顺序）',
          },
          requiredAnyOf: {
            type: 'array',
            description:
              '条件必填（OR-of-ANDs）：每组内参数需同时提供，至少满足一组',
            items: { type: 'array', items: { type: 'string' } },
          },
          requiredByOp: {
            type: 'object',
            description: '条件必填（按判别字段取值）：键为 action/op 的取值',
            additionalProperties: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
            },
          },
          opParam: {
            type: 'object',
            description: '族工具的判别字段与合法取值（缺省 = 非族工具）',
            properties: {
              name: {
                type: 'string',
                description: '判别字段名（op / mode / action）',
              },
              values: {
                type: 'array',
                items: { type: 'string' },
                description: '合法取值',
              },
            },
            required: ['name', 'values'],
          },
          autoDisclosed: {
            type: 'boolean',
            description:
              '是否在本轮自动下发的工具清单中；false ≠ 不可调用（预算/任务裁剪时仍可按名调用，见 notAutoDisclosedHint）',
          },
          notAutoDisclosedReasons: {
            type: 'array',
            items: { type: 'string' },
            description: '未自动下发的原因码（自动下发时为空数组）',
          },
          notAutoDisclosedHint: {
            type: 'string',
            description:
              '未自动下发原因的中文解释，并明确「是否仍可按名调用」（自动下发时缺省）',
          },
        },
        required: [
          'name',
          'description',
          'requiredParams',
          'autoDisclosed',
          'notAutoDisclosedReasons',
        ],
      },
    },
    diagnostics: {
      type: 'array',
      description: '未命中项的结构化原因（select: 与关键词分支共用）',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '被查询但未命中的名字' },
          reason: {
            type: 'string',
            enum: [
              'not_registered',
              'declared_unregistered',
              'archived',
              'capability_gated',
              'feature_gate_off',
              'task_filtered',
              'alias',
            ],
            description: '未命中原因',
          },
          hint: { type: 'string', description: '处置建议（如何拿到该能力）' },
        },
        required: ['name', 'reason'],
      },
    },
    reason: {
      type: 'string',
      description:
        '未命中的主原因：select: 分支等价 diagnostics[0].reason；关键词分支无已知名时固定为 no_keyword_match',
    },
    hint: {
      type: 'string',
      description: '未命中的主处置建议',
    },
  },
  required: ['matches', 'query', 'total_deferred_tools', 'deferredToolNames'],
};

/**
 * 验证 ToolSearchTool 输入
 */
export function validateToolSearchInput(input: unknown) {
  const result = ToolSearchInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `ToolSearchTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
