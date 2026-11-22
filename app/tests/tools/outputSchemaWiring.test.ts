/**
 * P2-1（2026-11-22，G5）：出参契约校验必须接在**所有执行入口**上。
 *
 * 背景：`validateToolOutputShape` 此前只在 `ToolExecutor` 调用 ⇒ 主聊天链
 * （`ToolExecutionService → ToolRegistry`）与 LRO 直调路径上的 `outputSchema` 声明形同虚设。
 * 本用例是**结构性守卫**：入口少接一处即失败（行为语义由 `toolOutputSchema.test.ts` 覆盖）。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('outputSchema 校验接线（G5）', () => {
  const entries: ReadonlyArray<readonly [string, string]> = [
    ['ToolExecutor', '../../src/tools/ToolExecutor.ts'],
    ['ToolRegistry', '../../src/tools/ToolRegistry.ts'],
    ['LRO stepExecution', '../../src/tasks/lro/stepExecution.ts'],
  ];

  for (const [label, file] of entries) {
    it(`${label} 调用 validateToolOutputShape 并标注 outputSchemaError`, () => {
      const src = read(file);
      expect(src).toContain('validateToolOutputShape(');
      expect(src).toContain('outputSchemaError');
    });
  }

  it('纯函数位于 infra（执行入口不 import 重依赖，LRO 也不直连 @modules/tools）', () => {
    const registry = read('../../src/tools/ToolRegistry.ts');
    const lro = read('../../src/tasks/lro/stepExecution.ts');
    expect(registry).toContain("from './outputSchemaValidation'");
    expect(lro).toContain(
      "from '@openliri/infra/utils/toolContract/outputSchemaValidation'"
    );
    expect(registry).not.toContain("from './ToolExecutor'");
  });
});
