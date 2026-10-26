// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * LRO-10（2026-10-26 剩余半边）：**成功但完全没有输出**的调用必须标 `emptyResult` 并提示。
 *
 * 失败窗口实测：这类调用返回 success 却拿不到任何信息，模型误以为"命令跑过了、环境就是
 * 这样"，于是继续盲试下一条（`cd /d %CD% && …` 只带回一条预处理告警）。
 *
 * 口径：空输出**不是失败**（`mkdir` 等正常静默）⇒ 状态仍是 success、不进熔断预算，
 * 只做两件事：① `metadata.emptyResult=true`（结构化事实）；② 正文改成明确提示。
 *
 * 用例分两层：判定逻辑走纯函数（不依赖具体 shell 的空输出命令，避免平台差异），
 * 接线走源码断言 + 一条真实执行的正向对照。
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  BashTool,
  resetGraySwitchWarningForTest,
} from '../../src/tools/bash/BashTool.js';
import { isEmptyOutput } from '../../src/tools/utils/ToolUtils.js';
import { ApprovedCommandRegistry } from '../../src/permission/ApprovedCommandRegistry.js';
import type { ToolUseContext } from '../../src/tools/types/Tool.js';

const BASH_TOOL_SRC = readFileSync(
  new URL('../../src/tools/bash/BashTool.ts', import.meta.url),
  'utf8'
);
const PWSH_TOOL_SRC = readFileSync(
  new URL('../../src/tools/PowerShellTool/PowerShellTool.ts', import.meta.url),
  'utf8'
);

function makeContext(sessionId: string): ToolUseContext {
  return {
    sessionId,
    options: {} as ToolUseContext['options'],
    abortController: new AbortController(),
    readFileState: {},
  } as unknown as ToolUseContext;
}

describe('LRO-10：空输出判定（纯函数）', () => {
  it('stdout / stderr 都为空（含纯空白）⇒ 空输出', () => {
    expect(isEmptyOutput('', '')).toBe(true);
    expect(isEmptyOutput('   \n\t ', '')).toBe(true);
    expect(isEmptyOutput('', '  \n')).toBe(true);
  });

  it('任一有内容 ⇒ 非空输出（stderr 本身就是信息）', () => {
    expect(isEmptyOutput('hi', '')).toBe(false);
    expect(isEmptyOutput('', 'warning: x')).toBe(false);
    expect(isEmptyOutput('   ', '  \n err')).toBe(false);
  });
});

describe('LRO-10：两个 shell 工具接线（同一口径）', () => {
  it('BashTool 成功路径必须打标 + 换成提示（不改状态、不改失败语义）', () => {
    expect(BASH_TOOL_SRC).toContain('const emptyResult = isEmptyOutput(');
    expect(BASH_TOOL_SRC).toContain('EMPTY_OUTPUT_HINT : output');
    expect(BASH_TOOL_SRC).toContain('metadata: { emptyResult: true }');
    expect(BASH_TOOL_SRC).toContain("logger.info('bash: empty_result'");
    // 空输出不得被写成失败（否则会进熔断预算，语义错位）
    expect(BASH_TOOL_SRC).not.toContain(
      'emptyResult ? ToolExecutionStatus.FAILURE'
    );
  });

  it('PowerShellTool 同型：同一纯函数 + 同一提示 + 同一标记', () => {
    expect(PWSH_TOOL_SRC).toContain('const emptyResult = isEmptyOutput(');
    expect(PWSH_TOOL_SRC).toContain('EMPTY_OUTPUT_HINT : output');
    expect(PWSH_TOOL_SRC).toContain('metadata: { emptyResult: true }');
    expect(PWSH_TOOL_SRC).toContain("logger.info('powershell: empty_result'");
  });

  it('真实执行有输出的命令 ⇒ 不标 emptyResult、正文保留原文', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    try {
      const tool = new BashTool(reg);
      const result = await tool.execute(
        { command: 'echo lro10-visible' },
        makeContext('sess-visible')
      );

      expect(result.success).toBe(true);
      expect(result.metadata?.emptyResult).toBeUndefined();
      expect(String(result.data ?? '')).toContain('lro10-visible');
      expect(String(result.data ?? '')).not.toContain('没有任何输出');
    } finally {
      reg.dispose();
      resetGraySwitchWarningForTest();
    }
  });
});
