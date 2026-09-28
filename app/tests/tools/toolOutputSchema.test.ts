/**
 * P1-3 A 档（2026-09-28）：工具出参运行期校验的**约定回归**。
 *
 * 覆盖 5 条不变量：
 *  1. **未声明 `outputSchema` ⇒ 不校验**（与改动前行为完全一致 —— 这是"零破坏"的关键）；
 *  2. 合规 ⇒ 通过（返回 null）；
 *  3. 不合规 ⇒ 返回**详情文本**（调用方只记录、**不阻断**）；
 *  4. schema 自身抛错 ⇒ **不向上抛**，返回"执行异常"文本；
 *  5. `data` 为 `null`/`undefined` ⇒ **无载荷不校验**（T4 补：错误分支不该被判违规）。
 */
import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import { validateToolOutputShape } from '@modules/tools/ToolExecutor';
import type { ToolResult } from '@modules/tools/types/ToolResult';

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
});
