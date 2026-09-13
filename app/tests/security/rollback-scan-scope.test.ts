// MIT License
// Copyright (c) 2026 Liri
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 轮次扫描作用域回归（O43 留档项「scanPaths 收窄」，2026-09-13）
 *
 * 守护的**具体缺陷**：轮次起始快照 `scanDirectory` 未排除 `.git` / `node_modules`，
 * 而新文件检测 `collectNewFiles` 排除了 → 两处作用域不一致，`.git` 抖动被整仓登记为
 * `scan` 变更（O43 实测：单轮数千条，后置备份一度 3,587 文件/10s）。
 * 修复后两处共用 `SCAN_EXCLUDED_DIRS`。
 *
 * 同时**固化语义代价**（有意为之）：`.git` / `node_modules` 内的改动不再被登记 ——
 * 这类改动本就无操作前备份、不可精确恢复，登记它只有噪音。
 */
import { describe, test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileOperationTracker } from '../../src/security/rollback/FileOperationTracker';

describe('轮次扫描作用域（scanPaths 收窄）', () => {
  test('.git / node_modules 抖动不计入变更，源码变更仍被登记', async () => {
    const root = mkdtempSync(join(tmpdir(), 'liri-scan-scope-'));
    try {
      mkdirSync(join(root, '.git'), { recursive: true });
      mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
      mkdirSync(join(root, '__pycache__'), { recursive: true });
      mkdirSync(join(root, '.venv'), { recursive: true });
      mkdirSync(join(root, 'src'), { recursive: true });
      const gitHead = join(root, '.git', 'HEAD');
      const depFile = join(root, 'node_modules', 'pkg', 'index.js');
      const pycacheFile = join(root, '__pycache__', 'a.pyc');
      const venvFile = join(root, '.venv', 'pyvenv.cfg');
      const srcFile = join(root, 'src', 'a.ts');
      writeFileSync(gitHead, 'ref: refs/heads/main\n');
      writeFileSync(depFile, 'x\n');
      writeFileSync(pycacheFile, 'p\n');
      writeFileSync(venvFile, 'v\n');
      writeFileSync(srcFile, 'a\n');

      const tracker = new FileOperationTracker();
      await tracker.recordRoundStart('s1', 1, [root]);
      // 懒快照：基线在本轮首个 shell 工具执行前建立（对齐 ToolExecutionService 的触发点）
      await tracker.ensureRoundStartSnapshot();

      // 模拟 shell 抖动：被排除目录与源码目录下的文件**都**被改动（且长度变化，确保本可被检出）
      writeFileSync(gitHead, 'ref: refs/heads/other-longer\n');
      writeFileSync(depFile, 'y-longer\n');
      writeFileSync(pycacheFile, 'p-longer\n');
      writeFileSync(venvFile, 'v-longer\n');
      writeFileSync(srcFile, 'b-longer\n');

      const { scanStatus } = await tracker.detectShellSideEffects();
      const changed = tracker.getChanges().map((change) => change.path);

      expect(scanStatus).toBe('complete');
      expect(changed).toContain(srcFile);
      expect(changed.some((p) => p.includes('.git'))).toBe(false);
      expect(changed.some((p) => p.includes('node_modules'))).toBe(false);
      expect(changed.some((p) => p.includes('__pycache__'))).toBe(false);
      expect(changed.some((p) => p.includes('.venv'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('本轮未执行 shell（基线未建立）时：文件被改动也不产生 scan 变更', async () => {
    const root = mkdtempSync(join(tmpdir(), 'liri-scan-lazy-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      const srcFile = join(root, 'src', 'a.ts');
      writeFileSync(srcFile, 'a\n');

      const tracker = new FileOperationTracker();
      await tracker.recordRoundStart('s1', 1, [root]);
      // 故意**不**调用 ensureRoundStartSnapshot：模拟"本轮没有任何 shell 工具"

      writeFileSync(srcFile, 'b-longer\n');

      const startedAt = Date.now();
      const { scanStatus } = await tracker.detectShellSideEffects();

      // 无 shell 即无 shell 副作用：不仅结果为空，且不付出扫描成本
      expect(scanStatus).toBe('complete');
      expect(tracker.getChanges()).toHaveLength(0);
      expect(Date.now() - startedAt).toBeLessThan(500);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('ensureRoundStartSnapshot 幂等：重复调用不重复扫描', async () => {
    const root = mkdtempSync(join(tmpdir(), 'liri-scan-idem-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'src', 'a.ts'), 'a\n');

      const tracker = new FileOperationTracker();
      await tracker.recordRoundStart('s1', 1, [root]);
      await tracker.ensureRoundStartSnapshot();
      const srcFile = join(root, 'src', 'a.ts');
      writeFileSync(srcFile, 'b-longer\n');
      // 第二个 shell 工具：基线仍是第一个 shell 之前的状态，不应把中间改动当成基线
      await tracker.ensureRoundStartSnapshot();

      await tracker.detectShellSideEffects();
      expect(tracker.getChanges().map((c) => c.path)).toContain(srcFile);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
