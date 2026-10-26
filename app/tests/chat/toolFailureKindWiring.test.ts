/**
 * LRO-09 步骤 1b（2026-10-26）：`ToolResultEntry.failureKind` 的生产者接线
 *
 * 背景：熔断只看 `status === 'error'`，把"权限拒绝 / 安全拦截 / 工具报错"混进同一预算，
 * 最不可自愈的那类最快烧完预算（4 秒熔断的实测根因）。分型字段落地的**前提**是所有
 * 生产者按结构化依据写入它；一旦被"顺手删掉"，后续双预算（步骤 3）会静默退回旧行为。
 *
 * 结构断言（源码级）+ 纯函数行为断言（`recordSkippedToolCall` 无依赖，无需 mock）。
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  recordSkippedToolCall,
  type ToolRoundResults,
} from '../../src/chat/toolResultPostProcess.js';
import type { ToolCallEntry } from '../../src/query/ReActLoop.js';
import { standardizeCommand } from '../../src/tools/bash/commandNormalization.js';

const POST_PROCESS_SRC = readFileSync(
  new URL('../../src/chat/toolResultPostProcess.ts', import.meta.url),
  'utf8'
);
const EXEC_SERVICE_SRC = readFileSync(
  new URL('../../src/chat/services/ToolExecutionService.ts', import.meta.url),
  'utf8'
);
const TOOL_LOOP_SRC = readFileSync(
  new URL('../../src/chat/ReActToolLoop.ts', import.meta.url),
  'utf8'
);
const BASH_TOOL_SRC = readFileSync(
  new URL('../../src/tools/bash/BashTool.ts', import.meta.url),
  'utf8'
);

function makeCall(id = 'tc1', name = 'file_write'): ToolCallEntry {
  return { id, name, input: { file_path: 'a.txt' } };
}

describe('failureKind 生产者接线（LRO-09 步骤 1b）', () => {
  it('跳过调用：显式分类写入 results，且 processedResults 双写配对完整', () => {
    const round: ToolRoundResults = { results: [], processedResults: [] };
    recordSkippedToolCall(
      round,
      makeCall(),
      '路径被安全护栏拦截',
      'safety_blocked'
    );

    expect(round.results).toHaveLength(1);
    expect(round.results[0].failureKind).toBe('safety_blocked');
    expect(round.results[0].status).toBe('error');
    // PAIR-FILL：assistant 的 tool_calls 必须都有对应 tool 结果，否则 400
    expect(round.processedResults).toHaveLength(1);
    expect(round.processedResults[0].normalizedToolCall.id).toBe('tc1');
    expect(round.processedResults[0].result.toolCallId).toBe('tc1');
    expect(round.processedResults[0].result.error).toBe('路径被安全护栏拦截');
  });

  it('跳过调用：未给出依据时不得臆造分类（缺省 = 未分类）', () => {
    const round: ToolRoundResults = { results: [], processedResults: [] };
    recordSkippedToolCall(round, makeCall('tc2', 'bash'), '用户取消执行');

    expect(round.results[0].failureKind).toBeUndefined();
  });

  it('成功路径生产者：优先沿用上游分类，缺省按工具自身失败兜底', () => {
    expect(POST_PROCESS_SRC).toContain(
      "toolResult.failureKind ?? (toolResult.error ? 'tool_error' : undefined)"
    );
  });

  it('权限生产者：DENY 与「审批未能提交」两处都标 permission_denied', () => {
    const hits =
      EXEC_SERVICE_SRC.match(/failureKind: 'permission_denied'/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it('LRO-07：规则拒绝的结构化依据进工具结果（metadata.permissionDeny）', () => {
    // 此前 `decision.context` 在 checkPermissionForTool 归一化时被截断 ⇒ 工具结果 metadata 为 null，
    // 模型/用户只能看到一句 reason。这里钉住"结构化字段必须被搬进 ToolResult.metadata"。
    expect(EXEC_SERVICE_SRC).toContain(
      'metadata: { permissionDeny: permissionResult.denyInfo }'
    );
    expect(EXEC_SERVICE_SRC).toContain('denyInfo?: PermissionDenyInfo');
  });

  it('安全生产者：PathGuard 跳过标 safety_blocked', () => {
    expect(TOOL_LOOP_SRC).toContain("'safety_blocked'");
  });

  it('BashTool 预处理"禁止"分支：改判失败态并标 safety_blocked（LRO-09 步骤 4）', () => {
    // 触发前提仍是真实存在的（`cd /usr` 在 Windows 语义下产生 `禁止:` 告警；
    // 不要用 `/tmp` —— 它会被改写为 `%TEMP%`，早于"禁止"检测）
    const std = standardizeCommand('cd /usr', { isWindows: true });
    expect(std.warnings.some((w) => w.includes('禁止'))).toBe(true);

    // 分支必须同时给出：失败态 + 结构化分类 + error（会话侧 status 由 error 派生）
    const branch = BASH_TOOL_SRC.slice(
      BASH_TOOL_SRC.indexOf("w.includes('禁止')"),
      BASH_TOOL_SRC.indexOf('command = std.preprocessed')
    );
    expect(branch).toContain('status: ToolExecutionStatus.FAILURE');
    expect(branch).toContain("failureKind: 'safety_blocked'");
    expect(branch).toContain('error: warningMsg');
  });
});
