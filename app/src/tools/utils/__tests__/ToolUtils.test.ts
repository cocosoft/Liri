/**
 * ToolUtils.resolveFilePath / getToolBaseDir 单元测试（G3）
 *
 * 覆盖：
 * - 无 baseDir：相对路径回退 outputDir（向后兼容）
 * - 有 baseDir：相对路径解析到 baseDir（cwd 优先）
 * - 绝对路径不受 baseDir 影响
 * - getToolBaseDir：cwd 存在返回、缺省 undefined
 */
import { describe, test, expect } from 'bun:test';
import { join } from 'path';
import { resolveFilePath, getToolBaseDir } from '../ToolUtils';
import { resolveOutputDir } from '@modules/core';

describe('resolveFilePath（G3 cwd 基准）', () => {
  test('无 baseDir：相对路径回退 outputDir（向后兼容）', () => {
    const resolved = resolveFilePath('report.md');
    expect(resolved).toBe(join(resolveOutputDir(), 'report.md'));
  });

  test('有 baseDir：相对路径解析到 baseDir', () => {
    const baseDir = join(process.cwd(), 'worktree-proj');
    const resolved = resolveFilePath('src/a.ts', baseDir);
    expect(resolved).toBe(join(baseDir, 'src', 'a.ts'));
  });

  test('绝对路径不受 baseDir 影响', () => {
    const abs = join(process.cwd(), 'abs', 'a.ts');
    const resolved = resolveFilePath(abs, '/some/other/base');
    expect(resolved).toBe(abs);
  });

  test('Windows 反斜杠归一化', () => {
    const baseDir = join(process.cwd(), 'proj');
    const resolved = resolveFilePath('sub\\file.txt', baseDir);
    expect(resolved).toBe(join(baseDir, 'sub', 'file.txt'));
  });
});

describe('getToolBaseDir（G3）', () => {
  test('context 有 cwd 时返回 cwd', () => {
    const cwd = '/worktree/abc';
    expect(getToolBaseDir({ options: { cwd } })).toBe(cwd);
  });

  test('context 无 cwd / 空 cwd / 无 context 时返回 undefined', () => {
    expect(getToolBaseDir({ options: {} })).toBeUndefined();
    expect(getToolBaseDir({ options: { cwd: '' } })).toBeUndefined();
    expect(getToolBaseDir(undefined)).toBeUndefined();
  });
});
