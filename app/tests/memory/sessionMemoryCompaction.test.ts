/**
 * P0-2（2026-11-25）会话记忆结构化压缩单测。
 *
 * 规格：`.trae/specs/agent-memory-optimization.md` §4 P0-2-3
 * 覆盖：超限触发压缩 · 决策/规则 100% 保留 · 流水账按类型只留最近 N 条 · 总量预算。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SessionMemoryManager } from '@openliri/service/session/memory/SessionMemoryManager';

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (!dir) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

const RULES = [
  '决策A：始终用相对路径',
  '决策B：先门禁后提交',
  '陷阱C：不要动沙箱目录',
];

/** 造一份 >10KB 的 memory.md：3 条规则写在最前（截断式压缩会丢掉它们） */
function seedLargeMemory(baseDir: string, sessionId: string): void {
  const dir = join(baseDir, sessionId);
  mkdirSync(dir, { recursive: true });
  const lines = ['# Session Memory', ''];
  for (const rule of RULES) {
    lines.push(`[2026-01-01T00:00:00.000Z] [decision] ${rule}`);
  }
  for (let i = 0; i < 80; i++) {
    lines.push(
      `[2026-01-02T00:00:00.000Z] [file_change] 工具 edit → src/very/long/path/file_${i}.ts（${'填充'.repeat(40)}）`
    );
  }
  for (let i = 0; i < 40; i++) {
    lines.push(
      `[2026-01-02T00:00:00.000Z] [discussion] 讨论 ${i} ${'内容'.repeat(20)}`
    );
  }
  writeFileSync(join(dir, 'memory.md'), lines.join('\n') + '\n', 'utf-8');
}

describe('_compactMemoryFile（结构化压缩）', () => {
  it('超限 ⇒ 规则全保留、流水账只留最近 N 条、总量受预算约束', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'session-memory-compact-'));
    createdDirs.push(baseDir);
    const sessionId = 'sess-1';
    seedLargeMemory(baseDir, sessionId);

    const manager = new SessionMemoryManager(baseDir);
    // 触发链：追加一条 → 文件 >10KB → 结构化压缩
    manager.extractPerTurn(sessionId, [
      {
        role: 'assistant',
        tool_calls: [
          {
            function: { name: 'edit', arguments: '{"filePath":"a.ts"}' },
          },
        ],
      },
    ]);

    const memory = manager.loadMemory(sessionId);
    const decisions = memory.items
      .filter((item) => item.type === 'decision')
      .map((item) => item.content);

    // 关键规则 100% 保留（原实现"保留最近 20 行"会全部丢掉）
    expect(decisions).toEqual(expect.arrayContaining(RULES));
    expect(
      memory.items.filter((i) => i.type === 'file_change').length
    ).toBeLessThanOrEqual(15);
    expect(
      memory.items.filter((i) => i.type === 'discussion').length
    ).toBeLessThanOrEqual(15);
    // 预算：3 条规则 + 15 + 15（新增的 file_change 也计入该类的 15 条内）
    expect(memory.items.length).toBeLessThanOrEqual(33);
  });
});
