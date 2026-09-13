/**
 * BashTool cwd 隔离测试（G3 收尾）
 *
 * 验证：工具参数未指定 cwd 时，回退 context.options.cwd（worktree/会话工作目录）。
 * 通过"相对路径文件读取"证明命令在指定 cwd 内执行（而非进程默认 cwd）。
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BashTool } from '../BashTool';
import type { ToolUseContext } from '../../types/ToolUseContext';

let worktreeDir: string;
const marker = `marker-${Date.now().toString(36)}.txt`;

beforeAll(() => {
  worktreeDir = mkdtempSync(join(tmpdir(), 'bash-cwd-'));
  writeFileSync(join(worktreeDir, marker), 'cwd-isolated\n');
});

afterAll(() => {
  try {
    rmSync(worktreeDir, { recursive: true, force: true });
  } catch {
    // @ignore-catch
  }
});

function makeContext(cwd: string | undefined): ToolUseContext {
  return {
    options: { cwd },
    toolUseId: 'test-bash',
    sessionId: 'test-session',
  } as unknown as ToolUseContext;
}

const readCmd = process.platform === 'win32' ? 'type' : 'cat';

function outputOf(result: { output?: unknown; data?: unknown }): string {
  return String(result.output ?? result.data ?? '');
}

describe('BashTool cwd 隔离（G3）', () => {
  test('context.options.cwd 存在时，命令在指定目录执行（能找到 worktree 内文件）', async () => {
    const bash = new BashTool();
    const result = await bash.execute(
      { command: `${readCmd} ${marker}` },
      makeContext(worktreeDir)
    );
    // stdout 含标记文件内容 → 命令在 worktreeDir 内执行
    expect(outputOf(result)).toContain('cwd-isolated');
  });

  test('工具参数显式 cwd 优先于 context.options.cwd', async () => {
    const other = mkdtempSync(join(tmpdir(), 'bash-cwd-other-'));
    try {
      writeFileSync(join(other, marker), 'other-dir\n');
      const bash = new BashTool();
      const result = await bash.execute(
        { command: `${readCmd} ${marker}`, cwd: other },
        makeContext(worktreeDir)
      );
      expect(outputOf(result)).toContain('other-dir');
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test('无 cwd 时回退进程默认目录（不抛错）', async () => {
    const bash = new BashTool();
    const result = await bash.execute(
      { command: 'echo bash-cwd-fallback' },
      makeContext(undefined)
    );
    expect(outputOf(result)).toContain('bash-cwd-fallback');
  });
});
