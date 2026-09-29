/**
 * P1-3 A 档（2026-09-28）：工具出参运行期校验的**约定回归**。
 *
 * 覆盖 6 条不变量：
 *  1. **未声明 `outputSchema` ⇒ 不校验**（与改动前行为完全一致 —— 这是"零破坏"的关键）；
 *  2. 合规 ⇒ 通过（返回 null）；
 *  3. 不合规 ⇒ 返回**详情文本**（调用方只记录、**不阻断**）；
 *  4. schema 自身抛错 ⇒ **不向上抛**，返回"执行异常"文本；
 *  5. `data` 为 `null`/`undefined` ⇒ **无载荷不校验**（T4 补：错误分支不该被判违规）；
 *  6. **载荷在 `result` 上**（只填 `result` 的手写 ToolResult 工具）⇒ **同样被校验**（批次 3 补）；
 *  7. **D-10/D-15**：Task 家族**存活**工具（`task_stop`）的**真实** schema 确实在校验（合规过、篡改必报 ⇒ 非摆设）。
 */
import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import { validateToolOutputShape } from '@modules/tools/ToolExecutor';
import type { ToolResult } from '@modules/tools/types/ToolResult';
import { TaskStopOutputSchema } from '@modules/tools/TaskTool/schemas';

const schema = z.object({ count: z.number() });

describe('工具出参运行期校验（P1-3 A 档）', () => {
  it('未声明 outputSchema 的工具 ⇒ 不校验（返回 null）', () => {
    const result = { data: { anything: true } } as ToolResult;
    expect(validateToolOutputShape({ name: 'no-schema' }, result)).toBeNull();
  });

  it('出参合规 ⇒ 通过（返回 null）', () => {
    const result = { data: { count: 3 } } as ToolResult;
    expect(
      validateToolOutputShape({ name: 'demo', outputSchema: schema }, result)
    ).toBeNull();
  });

  it('出参不合规 ⇒ 返回详情文本（不抛错）', () => {
    const result = { data: { count: 'abc' } } as ToolResult;
    const detail = validateToolOutputShape(
      { name: 'demo', outputSchema: schema },
      result
    );
    expect(detail).not.toBeNull();
    expect(typeof detail).toBe('string');
    expect(detail).toContain('count');
  });

  it('schema 自身抛错 ⇒ 归为"执行异常"，不向上抛', () => {
    const broken = {
      safeParse() {
        throw new Error('boom');
      },
    };
    const result = { data: {} } as ToolResult;
    const detail = validateToolOutputShape(
      { name: 'demo', outputSchema: broken },
      result
    );
    expect(detail).toContain('执行异常');
    expect(detail).toContain('boom');
  });

  it('data 为 null/undefined ⇒ 无载荷不校验（错误分支不该被判违规）', () => {
    const schemaStr = z.string();
    expect(
      validateToolOutputShape({ name: 'demo', outputSchema: schemaStr }, {
        data: null,
      } as ToolResult)
    ).toBeNull();
    expect(
      validateToolOutputShape(
        { name: 'demo', outputSchema: schemaStr },
        {} as ToolResult
      )
    ).toBeNull();
  });

  it('载荷在 result 上（只填 result 的手写 ToolResult 工具）⇒ 同样被校验', () => {
    // 合规：data 缺省、result 有载荷 ⇒ 通过
    expect(
      validateToolOutputShape({ name: 'demo', outputSchema: schema }, {
        result: { count: 1 },
      } as ToolResult)
    ).toBeNull();
    // 不合规：必须报错 —— 证明"真的校验了"，而不是"因无载荷而跳过"
    expect(
      validateToolOutputShape({ name: 'demo', outputSchema: schema }, {
        result: { count: 'bad' },
      } as ToolResult)
    ).not.toBeNull();
  });

  it('D-10/D-15：Task 家族**存活**工具（task_stop）的真实出参契约确实在校验（非摆设）', () => {
    // ⚠️ 沿革（2026-09-29，D-15）：本例原对 TaskCreate/TaskGet/TaskList/TaskUpdate 四个 schema 断言，
    // 但这 4 个工具类**未注册进运行时注册表、无生产消费者**，已随 D-15 删除 ⇒ 改用 Task 家族里
    // **唯一的存活工具** `task_stop`（`TaskStopTool.ts:18` 消费其 schema，工具名在 `/v1/tools` 内）。
    // 类型由校验器实参派生（不用 unknown，避免"绕过契约形态"）
    type OutputSchemaParam = NonNullable<
      Parameters<typeof validateToolOutputShape>[0]['outputSchema']
    >;
    const outputSchema: OutputSchemaParam = TaskStopOutputSchema;
    const payload = {
      task_id: 't-1',
      previous_status: 'running',
      current_status: 'stopped',
      success: true,
      message: 'ok',
    };

    // ① 合规（真实出口形态）⇒ 通过
    expect(
      validateToolOutputShape({ name: 'task_stop', outputSchema }, {
        data: payload,
      } as ToolResult)
    ).toBeNull();
    // ② 不合规（把必填的 task_id 换成 number）⇒ 必须报错（证明真在校验而非跳过）
    const broken = JSON.parse(
      JSON.stringify(payload).replace(/"t-1"/, '1')
    ) as unknown;
    expect(
      validateToolOutputShape({ name: 'task_stop', outputSchema }, {
        data: broken,
      } as ToolResult)
    ).not.toBeNull();
  });
});
