/**
 * 迁移路径安全检查单元测试（Phase 2）
 *
 * 覆盖：
 *  - 源=目标目录 → 拒绝
 *  - 目标是源的子目录 → 拒绝
 *  - 系统目录作为目标 → 拒绝
 *  - 有效路径 → 通过（仅在系统可写目录下）
 */

import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ensureSafeMigrationPath,
  validateModelsDir,
} from '../../../src/ai/local/llama/LlamaCppServerManager.js';

describe('ensureSafeMigrationPath', () => {
  const safeDir = mkdtempSync(join(tmpdir(), 'llama-migrate-safe-'));
  const safeTarget = join(tmpdir(), 'llama-migrate-target');

  it('不同磁盘的独立路径应通过', () => {
    const res = ensureSafeMigrationPath(safeTarget, safeDir);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.safePath).toBeTruthy();
  });

  it('源目录与目标目录相同 → 拒绝', () => {
    const res = ensureSafeMigrationPath(safeDir, safeDir);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('相同'))).toBe(true);
  });

  it('目标是源的子目录 → 拒绝', () => {
    const sub = join(safeDir, 'subdir');
    const res = ensureSafeMigrationPath(sub, safeDir);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('子目录'))).toBe(true);
  });

  it('系统目录作为目标 → 拒绝', () => {
    const sys = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
    const res = ensureSafeMigrationPath(sys, safeDir);
    expect(res.valid).toBe(false);
  });
});

describe('validateModelsDir', () => {
  it('空字符串应返回无效', () => {
    const res = validateModelsDir('');
    expect(res.valid).toBe(false);
  });

  it('系统路径应被拒绝', () => {
    const sys = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/root';
    const res = validateModelsDir(sys);
    expect(res.valid).toBe(false);
  });

  it('合法可写路径应通过', () => {
    const dir = mkdtempSync(join(tmpdir(), 'llama-validate-'));
    const res = validateModelsDir(dir);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
