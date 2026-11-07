/**
 * PowerShellTool 工作目录解析 + HTTP 路径的**缺省 context** 回归（2026-11-07 真机缺陷）
 *
 * 真机复现（冒烟）：`POST /v1/tools/powershell/execute {"command":"Get-Date …"}`
 * 返回 `undefined is not an object (evaluating 'context.options.cwd')` —— HTTP 路径的
 * context 只有 `sessionId` 等字段，没有 `options`，而旧实现直接读 `context.options.cwd`。
 */
import { describe, expect, test } from 'bun:test';
import {
  PowerShellTool,
  resolvePowerShellWorkingDirectory,
} from '../../src/tools/PowerShellTool/PowerShellTool';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext';

describe('resolvePowerShellWorkingDirectory', () => {
  test('入参 workingDirectory 优先', () => {
    expect(resolvePowerShellWorkingDirectory('C:\\a', 'C:\\b')).toBe('C:\\a');
  });

  test('其次 context cwd；都缺 ⇒ 回落 process.cwd()', () => {
    expect(resolvePowerShellWorkingDirectory(undefined, 'C:\\b')).toBe('C:\\b');
    expect(resolvePowerShellWorkingDirectory(undefined, undefined)).toBe(
      process.cwd()
    );
  });
});

describe('execute 在缺省 context（HTTP 路径）下不崩', () => {
  test('context 无 options ⇒ 不再抛 options.cwd 的 TypeError', async () => {
    const tool = new PowerShellTool();
    // 只给 sessionId（与 HTTP 执行路径一致）；工作目录也不传 ⇒ 一定走到解析分支
    const context = {
      sessionId: 'sess-partial-context',
      toolUseId: 'tc-partial',
    } as unknown as ToolUseContext;

    // 用会被安全链判「需确认」的命令：在 spawn 之前就返回失败结果 ⇒ 用例不依赖 pwsh 是否安装
    const result = await tool.execute(
      { command: 'Remove-Item -Recurse C:\\Windows' },
      context
    );

    expect(result.success).toBe(false);
    const errorText = String((result as { error?: string }).error ?? '');
    expect(errorText).not.toContain('undefined is not an object');
    expect(errorText).not.toContain('options.cwd');
  });
});
