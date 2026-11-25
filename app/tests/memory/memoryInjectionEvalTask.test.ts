/**
 * P3-1 第 ⑤ 项（2026-11-25）：记忆注入遵循度评测任务的**定义自检**（不需要模型）。
 *
 * 目的：确认任务本身可用 —— setup 写入沙箱记忆索引、断言按"最后一行规则标记"判分；
 * 真实遵循度需用模型跑 `bun run eval -- --model=<名> --task=memory-injection-adherence`。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { memoryInjectionTasks } from '@modules/evals/tasks/memory-injection.js';

const createdDirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

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

const task = memoryInjectionTasks.find(
  (t) => t.id === 'memory-injection-adherence'
);

describe('memory-injection-adherence 任务定义', () => {
  it('任务存在且为 L1 正向断言（含参考解审计）', () => {
    expect(task).toBeDefined();
    expect(task?.level).toBe('L1');
    expect(task?.assertionPolarity).toBe('positive');
    expect(task?.assertionAudit?.artifacts.length).toBeGreaterThan(0);
  });

  it('setup 在沙箱记忆目录写入索引与规则条目', async () => {
    if (!task?.setup) throw new Error('任务缺少 setup');
    const dataDir = makeDir('eval-mem-data-');
    const workspace = makeDir('eval-mem-ws-');
    await task.setup({ dataDir, workspace, home: makeDir('eval-mem-home-') });

    const indexPath = join(dataDir, 'memory', 'global', 'MEMORY.md');
    const rulePath = join(dataDir, 'memory', 'global', 'eval_rule.md');
    expect(existsSync(indexPath)).toBe(true);
    expect(existsSync(rulePath)).toBe(true);
    expect(readFileSync(indexPath, 'utf-8')).toContain('EVAL_MEMO_RULE');
  });

  it('断言：最后一行是规则标记 ⇒ 通过；缺失 ⇒ 失败', async () => {
    if (!task) throw new Error('任务缺失');
    const workspace = makeDir('eval-mem-assert-');
    mkdirSync(join(workspace, 'eval_out'), { recursive: true });

    const base = {
      workspace,
      home: workspace,
      dataDir: workspace,
      finalText: '',
      toolCalls: [],
      sessionId: 'eval',
      model: 'stub',
    };

    writeFileSync(
      join(workspace, 'eval_out', 'memo.txt'),
      '你好\nEVAL_MEMO_RULE\n'
    );
    const ok = await task.assert(base);
    expect(ok.pass).toBe(true);

    writeFileSync(join(workspace, 'eval_out', 'memo.txt'), '你好\n');
    const bad = await task.assert(base);
    expect(bad.pass).toBe(false);
    expect(bad.reason).toContain('EVAL_MEMO_RULE');
  });
});
