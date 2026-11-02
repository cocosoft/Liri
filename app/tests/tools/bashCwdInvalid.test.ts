/**
 * P0（2026-11-03）：BashTool 的 **cwd 先验**（导出记录里最大一类失败的根因修复）
 *
 * 背景（`dev_docs/20261103/工具cwd无效根因与修复方案-20261103.md`）：
 * 会话/项目工作目录指向不存在的路径时，`exec` 的 spawn 抛
 * `ENOENT: no such file or directory, uv_spawn 'C:\Windows\system32\cmd.exe'`
 * —— 把"cwd 无效"误报成"cmd.exe 不存在"，一次会话里连续失败 ≥12 次。
 *
 * 覆盖：
 * ① cwd 不存在 ⇒ spawn 前失败，文案点名"工作目录"且明确"不是 cmd.exe 缺失"；
 * ② cwd 是文件（存在但不能作为目录）⇒ 同样拒绝（避免 ENOTDIR）；
 * ③ 有效 cwd ⇒ 正常执行（零回归）。
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BashTool } from '../../src/tools/bash/BashTool.js';
import { ToolExecutionStatus } from '../../src/tools/types/ToolResult';
import { ApprovedCommandRegistry } from '@openliri/infra/permission/ApprovedCommandRegistry';
import type { ToolUseContext } from '../../src/tools/types/Tool.js';

function makeContext(sessionId: string): ToolUseContext {
  return {
    sessionId,
    options: {} as ToolUseContext['options'],
    abortController: new AbortController(),
    readFileState: {},
  } as unknown as ToolUseContext;
}

function makeTool(): { tool: BashTool; dispose: () => void } {
  const registry = new ApprovedCommandRegistry(60_000, false);
  return { tool: new BashTool(registry), dispose: () => registry.dispose() };
}

describe('BashTool cwd 先验（P0，2026-11-03）', () => {
  it('cwd 不存在 ⇒ 在执行前失败，且不复述误导性的 cmd.exe ENOENT', async () => {
    const { tool, dispose } = makeTool();
    try {
      const missing = join(tmpdir(), `liri-no-such-dir-${Date.now()}`);
      const result = await tool.execute(
        { command: 'echo probe', cwd: missing },
        makeContext('session-cwd-1')
      );

      expect(result.status).toBe(ToolExecutionStatus.FAILURE);
      expect(result.failureKind).toBe('tool_error');
      const message = String(result.error ?? '');
      expect(message).toContain('Bash 工作目录不存在');
      expect(message).toContain('不是 cmd.exe 缺失');
      expect(message).not.toContain('uv_spawn');
    } finally {
      dispose();
    }
  });

  it('cwd 是文件（存在但不是目录）⇒ 拒绝', async () => {
    const { tool, dispose } = makeTool();
    const dir = mkdtempSync(join(tmpdir(), 'liri-cwd-file-'));
    try {
      const filePath = join(dir, 'not-a-dir.txt');
      writeFileSync(filePath, 'x', 'utf8');
      const result = await tool.execute(
        { command: 'echo probe', cwd: filePath },
        makeContext('session-cwd-2')
      );

      expect(result.status).toBe(ToolExecutionStatus.FAILURE);
      expect(String(result.error ?? '')).toContain('不是目录');
    } finally {
      dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('有效 cwd ⇒ 正常执行（零回归）', async () => {
    const { tool, dispose } = makeTool();
    const dir = mkdtempSync(join(tmpdir(), 'liri-cwd-ok-'));
    try {
      const result = await tool.execute(
        { command: 'echo liri-cwd-ok', cwd: dir },
        makeContext('session-cwd-3')
      );
      expect(result.success).toBe(true);
      expect(String(result.data ?? '')).toContain('liri-cwd-ok');
    } finally {
      dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
