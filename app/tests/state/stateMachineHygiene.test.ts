/**
 * 状态机取证隐患**源码守卫**（状态机方案 阶段 1.3，2026-10-12）。
 *
 * 三项隐患已修，本守卫防其**回流**（做法对齐 `tests/channels/channelTruncationGuard.test.ts`）：
 * ① `awaiting_approval` / `requires_approval` 不得再以**裸字面量**出现在 `ToolExecutionService`；
 * ② 应用安装状态不得再以**内联字面量联合**重复书写（须用 `AppInstallStatus`）；
 * ③ `BudgetMode` 不得在 `DailyBudgetManager` **本地重声明**（单一事实源 = `dailyBudgetSnapshot`）。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** 统计字面量子串出现次数（用于"唯一事实源只允许出现一次"断言） */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('状态机取证隐患守卫（阶段 1.3）', () => {
  it('工具执行瞬态：裸字面量已收敛到唯一事实源（各只出现 1 次定义）', () => {
    const src = read('app/src/chat/services/ToolExecutionService.ts');

    // `awaiting_approval` 仅作为 TRANSIENT_AWAITING_APPROVAL 的**定义值**出现 1 次
    expect(countOccurrences(src, "'awaiting_approval'")).toBe(1);
    expect(src).toContain(
      "const TRANSIENT_AWAITING_APPROVAL = 'awaiting_approval'"
    );
    // `requires_approval` 则**零**字面量（走枚举成员）
    expect(countOccurrences(src, "'requires_approval'")).toBe(0);
    expect(src).toContain('ToolExecutionStatus.REQUIRES_APPROVAL');
  });

  it('应用安装状态：内联联合仅剩 1 处定义（= 命名类型），消费点全走类型名', () => {
    const src = read('app/src/appState/AppState.ts');

    // 断言改用**空白容忍**正则：prettier 会把联合式折成多行 ⇒ 原「单行字符串」契据恒为 0
    // （该守卫曾因此静默恒失败、形同虚设 —— 2026-10-13 复查修正）。
    const inlineUnion =
      /'pending'\s*\|\s*'installing'\s*\|\s*'installed'\s*\|\s*'failed'/g;
    expect(src.match(inlineUnion)?.length ?? 0).toBe(1);
    expect(src).toContain('export type AppInstallStatus');
    expect(src).toContain('status: AppInstallStatus;');
  });

  it('预算档位：不再本地重声明（单一事实源 = dailyBudgetSnapshot）', () => {
    const src = read('app/src/query/DailyBudgetManager.ts');

    expect(src).not.toContain('type BudgetMode =');
    expect(src).toContain(
      "import type { BudgetMode } from './dailyBudgetSnapshot.js'"
    );
  });
});
