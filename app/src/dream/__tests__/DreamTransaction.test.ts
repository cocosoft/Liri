/**
 * DreamTransaction 单元测试
 *
 * 对齐方案 T1.3 测试清单：
 * 1. 模拟 patch 写入中途抛错 → 原文件内容完整还原（原子替换）
 * 2. rollback 也失败 → 错误被正确上报、备份快照保留供人工恢复
 * 3. 同 key 多 op 只备份一次
 * 4. 乐观锁冲突（apply 抛错）→ 整批回滚
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFile, writeFile, mkdir, rm, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { DreamTransaction, fileTx, TxOperation } from '../DreamTransaction.js';

describe('DreamTransaction', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = join(tmpdir(), 'dream-tx-test-' + randomUUID());
    await mkdir(baseDir, { recursive: true });
    // 覆盖 data 目录解析：通过 LIRI_DATA_DIR 指向临时目录
    process.env.LIRI_DATA_DIR = baseDir;
  });

  afterEach(async () => {
    delete process.env.LIRI_DATA_DIR;
    await rm(baseDir, { recursive: true, force: true });
  });

  test('写入中途抛错 → 原文件内容完整还原', async () => {
    const target = join(baseDir, 'soul.md');
    await writeFile(target, '原内容', 'utf-8');

    const op: TxOperation = fileTx(target, async () => {
      await writeFile(target, '半更新内容', 'utf-8');
      throw new Error('apply 中途失败');
    });

    await expect(DreamTransaction.run([op])).rejects.toThrow(
      '梦境事务执行失败'
    );

    const restored = await readFile(target, 'utf-8');
    expect(restored).toBe('原内容');
  });

  test('rollback 也失败 → 备份快照保留供人工恢复', async () => {
    const target = join(baseDir, 'soul.md');
    await writeFile(target, '原内容', 'utf-8');

    // apply 抛错触发回滚；rollback 也失败（备份丢失）
    const op: TxOperation = {
      kind: 'file',
      key: target,
      apply: async () => {
        await writeFile(target, '新内容', 'utf-8');
        throw new Error('apply 失败');
      },
      backup: async (dir: string) => {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'bk.bak'), '原内容', 'utf-8');
        await writeFile(
          join(dir, 'bk.meta.json'),
          JSON.stringify({ existed: true }),
          'utf-8'
        );
      },
      rollback: async () => {
        // 模拟备份丢失：恢复时抛错
        throw new Error('备份丢失');
      },
    };

    await expect(DreamTransaction.run([op])).rejects.toThrow(
      '梦境事务执行失败'
    );

    // 回滚失败 → 快照目录保留（供人工恢复）
    const kept = await readdir(join(baseDir, 'transactions'));
    expect(kept.some((d) => d.startsWith('tx_'))).toBe(true);
  });

  test('同 key 多 op 只备份一次（apply 全部执行）', async () => {
    const target = join(baseDir, 'soul.md');
    await writeFile(target, '原内容', 'utf-8');

    let backupCalls = 0;
    const mkOp = (suffix: string): TxOperation => ({
      kind: 'file',
      key: target,
      apply: async () => {
        await writeFile(target, `${suffix}-${Date.now()}`, 'utf-8');
      },
      backup: async (dir: string) => {
        backupCalls++;
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'b.bak'), '原内容', 'utf-8');
        await writeFile(
          join(dir, 'b.meta.json'),
          JSON.stringify({ existed: true }),
          'utf-8'
        );
      },
      rollback: async () => {},
    });

    await DreamTransaction.run([mkOp('a'), mkOp('b'), mkOp('c')]);

    // 同 key 去重 → backup 只调一次
    expect(backupCalls).toBe(1);
    // 全部成功 → 快照已删除（commit）
    const dirs = await readdir(baseDir);
    expect(dirs.some((d) => d.startsWith('tx_'))).toBe(false);
  });

  test('乐观锁冲突（apply 抛错）→ 整批回滚', async () => {
    const a = join(baseDir, 'a.md');
    const b = join(baseDir, 'b.md');
    await writeFile(a, 'A原内容', 'utf-8');
    await writeFile(b, 'B原内容', 'utf-8');

    const ops: TxOperation[] = [
      fileTx(a, async () => {
        await writeFile(a, 'A新内容', 'utf-8');
      }),
      fileTx(b, async () => {
        // 模拟乐观锁冲突：第二个 op apply 抛错
        throw new Error('乐观锁冲突');
      }),
    ];

    await expect(DreamTransaction.run(ops)).rejects.toThrow('梦境事务执行失败');

    // 整批回滚：两个文件都恢复原内容
    expect(await readFile(a, 'utf-8')).toBe('A原内容');
    expect(await readFile(b, 'utf-8')).toBe('B原内容');
  });
});
