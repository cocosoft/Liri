import { z } from 'zod';

/**
 * 计划步骤模式
 */
export const PlanStepSchema = z.object({
  id: z.string().describe('步骤唯一标识'),
  name: z.string().describe('步骤名称'),
  description: z.string().describe('步骤描述'),
  type: z
    .enum(['tool', 'command', 'condition', 'loop'])
    .describe(
      '步骤类型：tool 工具调用，command 命令执行，condition 条件判断，loop 循环'
    ),
  params: z.record(z.any()).describe('步骤参数'),
  dependencies: z
    .array(z.string())
    .optional()
    .describe('依赖的其他步骤 ID 列表'),
});

/**
 * PlanTool 输入模式
 */
export const PlanToolInputSchema = z.strictObject({
  action: z
    .enum(['create', 'list', 'get', 'update', 'delete', 'execute'])
    .describe(
      '操作类型：create 创建计划，list 列出计划，get 获取计划详情，update 更新计划，delete 删除计划，execute 执行计划'
    ),
  plan_id: z
    .string()
    .optional()
    .describe('计划 ID（get、update、delete、execute 操作必需）'),
  name: z.string().optional().describe('计划名称（create、update 操作使用）'),
  description: z
    .string()
    .optional()
    .describe('计划描述（create、update 操作使用）'),
  steps: z
    .array(PlanStepSchema)
    .optional()
    .describe('计划步骤列表（create 操作必需）'),
  status: z
    .enum(['draft', 'active', 'completed', 'cancelled'])
    .optional()
    .describe('计划状态（update 操作使用）'),
  execution_params: z
    .record(z.any())
    .optional()
    .describe('执行参数（execute 操作使用）'),
});

/**
 * 计划数据模式
 */
export const PlanDataSchema = z.object({
  id: z.string().describe('计划 ID'),
  name: z.string().describe('计划名称'),
  description: z.string().describe('计划描述'),
  steps: z.array(PlanStepSchema).describe('计划步骤'),
  status: z
    .enum(['draft', 'active', 'completed', 'cancelled'])
    .describe('计划状态'),
  created_at: z.string().describe('创建时间'),
  updated_at: z.string().describe('更新时间'),
});

/**
 * PlanTool 输出模式
 */
export const PlanToolOutputSchema = z.object({
  success: z.boolean().describe('操作是否成功'),
  message: z.string().describe('操作结果消息'),
  plan: PlanDataSchema.optional().describe(
    '计划数据（create、get、update 操作返回）'
  ),
  plans: z
    .array(PlanDataSchema)
    .optional()
    .describe('计划列表（list 操作返回）'),
  execution_result: z.any().optional().describe('执行结果（execute 操作返回）'),
});

export type PlanToolInput = z.infer<typeof PlanToolInputSchema>;
export type PlanToolOutput = z.infer<typeof PlanToolOutputSchema>;

/** U-03（2026-10-19）：`plan` 的步骤结构（模型可见 JSON Schema，与 `PlanStepSchema` 对齐） */
const PlanStepJsonSchema: Record<string, unknown> = {
  type: 'object',
  description: '计划步骤',
  properties: {
    id: { type: 'string', description: '步骤唯一标识' },
    name: { type: 'string', description: '步骤名称' },
    description: { type: 'string', description: '步骤描述' },
    type: {
      type: 'string',
      enum: ['tool', 'command', 'condition', 'loop'],
      description:
        '步骤类型：tool 工具调用 / command 命令执行 / condition 条件判断 / loop 循环',
    },
    params: { type: 'object', description: '步骤参数' },
    dependencies: {
      type: 'array',
      items: { type: 'string' },
      description: '依赖的其他步骤 ID 列表',
    },
  },
  required: ['id', 'name', 'description', 'type', 'params'],
};

/** U-03（2026-10-19）：`plan` 的计划结构（与 `PlanDataSchema` 对齐） */
const PlanDataJsonSchema: Record<string, unknown> = {
  type: 'object',
  description: '计划数据',
  properties: {
    id: { type: 'string', description: '计划 ID' },
    name: { type: 'string', description: '计划名称' },
    description: { type: 'string', description: '计划描述' },
    steps: {
      type: 'array',
      items: PlanStepJsonSchema,
      description: '计划步骤',
    },
    status: {
      type: 'string',
      enum: ['draft', 'active', 'completed', 'cancelled'],
      description: '计划状态',
    },
    created_at: { type: 'string', description: '创建时间' },
    updated_at: { type: 'string', description: '更新时间' },
  },
  required: [
    'id',
    'name',
    'description',
    'steps',
    'status',
    'created_at',
    'updated_at',
  ],
};

/**
 * U-03（2026-10-19）：`plan` 的**模型可见出参结构**（JSON Schema），
 * 与 `PlanToolOutputSchema` 逐字段对齐（`plan`/`plans`/`execution_result` 均按 action 出现）。
 */
export const PlanToolOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    success: { type: 'boolean', description: '操作是否成功' },
    message: { type: 'string', description: '操作结果消息' },
    plan: PlanDataJsonSchema,
    plans: {
      type: 'array',
      items: PlanDataJsonSchema,
      description: '计划列表（list 操作返回）',
    },
    execution_result: {
      description: '执行结果（execute 操作返回，结构随计划步骤变化）',
    },
  },
  required: ['success', 'message'],
};

/**
 * 验证 PlanTool 输入
 */
export function validatePlanToolInput(input: unknown) {
  const result = PlanToolInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `PlanTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  const { action, plan_id, name, steps } = result.data;
  if (['get', 'update', 'delete', 'execute'].includes(action) && !plan_id) {
    return {
      success: false as const,
      error: `PlanTool 输入验证失败: ${action} 操作需要提供 plan_id 参数`,
    };
  }
  if (['create', 'update'].includes(action) && !name) {
    return {
      success: false as const,
      error: `PlanTool 输入验证失败: ${action} 操作需要提供 name 参数`,
    };
  }
  if (action === 'create' && (!steps || steps.length === 0)) {
    return {
      success: false as const,
      error: 'PlanTool 输入验证失败: create 操作需要提供至少一个 steps 步骤',
    };
  }
  return { success: true as const, data: result.data };
}
