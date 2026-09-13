/**
 * runKnowledgeCompile 故障注入测试（方案 B v7 验收 #14 / #15）
 *
 * 目标：验证**初始化区抛错**时的两条不变量：
 * - G25：锁不泄漏（`isCompileRunning()` 必须回到 false）
 * - G8 ：后续编译仍能启动（不会永久返回 busy）
 *
 * 背景：v5 的 §3.3 曾把 `acquireCompileLock()` 放在 `try` 之外，而
 * `graph.init()` / `schemaLoader.loadAll()` / `lineage.init()` 都在 try 之外，
 * 任一抛错即跳过 finally → 锁永久占用 → 此后所有编译都返回 busy。
 *
 * 注入方式：`mock.module` 替换 KnowledgeGraph，使 `init()` 抛错（模拟 DB 不可用）。
 */
import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { setUserDataDirOverride } from '@modules/core/paths';

mock.module('@modules/knowledge/graph/KnowledgeGraph', () => ({
  KnowledgeGraph: class {
    async init(): Promise<void> {
      throw new Error('inject: graph.init failed');
    }
    async close(): Promise<void> {
      /* noop */
    }
  },
}));

// 必须在 mock.module 之后动态导入被测模块
const { runKnowledgeCompile, isCompileRunning } =
  await import('../KnowledgeCompiler');

let tempRoot = '';
beforeAll(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'kb-inject-'));
  setUserDataDirOverride(tempRoot);
});
afterAll(async () => {
  setUserDataDirOverride(null);
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('runKnowledgeCompile 故障注入（G1/G8/G25）', () => {
  it('init 抛错：错误上抛、锁已释放、后续仍能启动', async () => {
    // 注入点在 graph.init()，aiService 尚未被使用；用最小编译期占位避免 any
    const aiStub = {} as never;

    await expect(runKnowledgeCompile(aiStub)).rejects.toThrow(
      'inject: graph.init failed'
    );
    expect(isCompileRunning()).toBe(false); // G25：锁未泄漏

    // 第二次调用：不应因"锁被占用"而不启动，应再次走到同一注入点
    await expect(runKnowledgeCompile(aiStub)).rejects.toThrow(
      'inject: graph.init failed'
    );
    expect(isCompileRunning()).toBe(false);
  });
});
