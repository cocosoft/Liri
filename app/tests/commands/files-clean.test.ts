// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * /files clean 递归保护与 dry-run 测试（P1-2，2026-09-07）
 *
 * 覆盖：默认 dry-run 不删除；--delete 才删；node_modules 黑名单跳过；
 * 超过 MAX_DEPTH 的深层临时文件不收集。
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import filesCmd from '../../src/commands/builtin/files/Files.js';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'files-clean-test-'));
  // 应收集：根级临时文件
  writeFileSync(join(root, 'a.tmp'), 'x');
  writeFileSync(join(root, 'run.log'), 'x');
  // 黑名单目录：node_modules 下的临时文件不应被扫到
  mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'dep', 'inner.tmp'), 'x');
  // 深层目录：超过 MAX_DEPTH(4) 的不收集
  mkdirSync(join(root, 'd1', 'd2', 'd3', 'd4', 'd5'), { recursive: true });
  writeFileSync(join(root, 'd1', 'd2', 'd3', 'd4', 'd5', 'deep.tmp'), 'x');
  // 浅层目录：depth 1 收集
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'sub', 'b.bak'), 'x');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('/files clean 保护（P1-2）', () => {
  test('默认 dry-run：报告候选且不删除任何文件', async () => {
    const ctx = { cwd: root } as never;
    const res = await filesCmd.execute('clean', ctx);
    expect(res.success).toBe(true);
    expect((res.data as { dryRun?: boolean }).dryRun).toBe(true);
    const count = (res.data as { count?: number }).count ?? 0;
    // 根 a.tmp + run.log + sub/b.bak 收集（3）；node_modules 与深度 >4 的不计入
    expect(count).toBe(3);
    // 未删除
    expect(existsSync(join(root, 'a.tmp'))).toBe(true);
    expect(existsSync(join(root, 'sub', 'b.bak'))).toBe(true);
  });

  test('--delete：删除候选但跳过 node_modules 与超深目录', async () => {
    const ctx = { cwd: root } as never;
    const res = await filesCmd.execute('clean --delete', ctx);
    expect(res.success).toBe(true);
    expect((res.data as { deletedCount?: number }).deletedCount).toBe(3);

    expect(existsSync(join(root, 'a.tmp'))).toBe(false);
    expect(existsSync(join(root, 'run.log'))).toBe(false);
    expect(existsSync(join(root, 'sub', 'b.bak'))).toBe(false);
    // 黑名单内与超深目录未触碰
    expect(existsSync(join(root, 'node_modules', 'dep', 'inner.tmp'))).toBe(
      true
    );
    expect(
      existsSync(join(root, 'd1', 'd2', 'd3', 'd4', 'd5', 'deep.tmp'))
    ).toBe(true);
  });
});
