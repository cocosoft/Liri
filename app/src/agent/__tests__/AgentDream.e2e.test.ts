/**
 * 集成测试：Agent 执行 → 清理 → 梦境周期（方案 §6 端到端链路）
 *
 * 链路验证（真实临时目录、不 Mock）：
 * 1. Agent 执行：创建隔离环境 + EffectScope，登记副作用（临时文件/子进程资源模拟）
 * 2. Agent 清理：AgentCleanup.cleanup(scope) 委托 scope.dispose()，LIFO 释放
 * 3. 梦境周期：DreamTransaction.fileTx 事务化写入 SOUL/USER（失败回滚还原）
 *
 * 覆盖 T1.2 + T1.3 的跨模块协作语义。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { EffectScope } from '@modules/context';
import { AgentCleanup } from '../AgentCleanup.js';
import {
  createAgentIsolation,
  registerIsolationToScope,
} from '../AgentIsolation.js';
import { DreamTransaction, fileTx } from '../../dream/DreamTransaction.js';

describe('Agent → 清理 → 梦境 端到端链路', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = join(tmpdir(), 'agent-dream-e2e-' + randomUUID());
    await mkdir(baseDir, { recursive: true });
    // 覆盖 data 目录解析（DreamTransaction 备份落盘用）
    process.env.LIRI_DATA_DIR = baseDir;
  });

  afterEach(async () => {
    delete process.env.LIRI_DATA_DIR;
    await rm(baseDir, { recursive: true, force: true });
  });

  test('Agent 执行登记副作用 → 清理 LIFO 释放（abort 最先，文件清理）', async () => {
    // 1. Agent 执行：隔离 + scope
    const scope = new EffectScope();
    const isolation = createAgentIsolation('agent-' + randomUUID());
    registerIsolationToScope(isolation, scope, { cleanupWorkspace: true });

    // Agent 执行中创建临时文件
    const workDir = join(baseDir, 'agent-work');
    mkdirSync(workDir, { recursive: true });
    const tempFile = join(workDir, 'tmp.txt');
    writeFileSync(tempFile, 'agent temp');

    const releaseOrder: string[] = [];
    // 登记顺序：文件 → abort（abort 后登记先执行）
    scope.onDispose(() => {
      releaseOrder.push('file');
      rmSync(tempFile, { force: true });
    });
    scope.onDispose(() => {
      releaseOrder.push('abort');
      isolation.abort();
    });

    // 2. Agent 清理：AgentCleanup 委托 scope
    const cleanup = new AgentCleanup(workDir);
    const result = await cleanup.cleanup({
      sessionId: 's1',
      scope,
      tempFiles: [],
    });

    expect(result.success).toBe(true);
    expect(releaseOrder).toEqual(['abort', 'file']);
    expect(isolation.abortController.signal.aborted).toBe(true);
  });

  test('梦境周期 Write 事务化：SOUL/USER 写入失败 → 原子回滚还原', async () => {
    // 构造 SOUL/USER 文件
    const soulPath = join(baseDir, 'SOUL.md');
    const userPath = join(baseDir, 'USER.md');
    writeFileSync(soulPath, 'soul-原内容', 'utf-8');
    writeFileSync(userPath, 'user-原内容', 'utf-8');

    // 模拟 Write 阶段：soul 成功、user 冲突 → 整批回滚
    const ops = [
      fileTx(soulPath, async () => {
        await writeFile(soulPath, 'soul-已更新', 'utf-8');
      }),
      fileTx(userPath, async () => {
        // 模拟乐观锁冲突
        throw new Error('USER.md 乐观锁冲突');
      }),
    ];

    await expect(DreamTransaction.run(ops)).rejects.toThrow('梦境事务执行失败');

    // 整批回滚：两个文件均还原
    expect(await readFile(soulPath, 'utf-8')).toBe('soul-原内容');
    expect(await readFile(userPath, 'utf-8')).toBe('user-原内容');
  });

  test('梦境周期 Write 事务成功：SOUL/USER 原子写入并提交', async () => {
    const soulPath = join(baseDir, 'SOUL.md');
    writeFileSync(soulPath, 'soul-原内容', 'utf-8');

    await DreamTransaction.run([
      fileTx(soulPath, async () => {
        await writeFile(soulPath, 'soul-已更新', 'utf-8');
      }),
    ]);

    expect(await readFile(soulPath, 'utf-8')).toBe('soul-已更新');
    // commit 后备份快照删除
    const txRoot = join(baseDir, 'transactions');
    const leftovers = await import('fs/promises').then((fs) =>
      fs.readdir(txRoot).catch(() => [])
    );
    expect(leftovers.filter((d) => d.startsWith('tx_'))).toHaveLength(0);
  });
});
