// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PR-0（2026-10-23）：风险分级改为**工具声明式**的回归锁。
 *
 * 背景（真机日志）：`inferRiskClass('pdf')` 不匹配任何名字关键词 ⇒ 兜底 `SHELL`
 * ⇒ 只读的 `pdf extract/info` 每次调用都要人工审批（同一会话实测 6 次）。
 * 现口径：`riskClassFor` > `riskClass` > `TOOL_EFFECTS`/`sandboxLevel` > `isReadOnly` > `undeclared`。
 */

import { describe, it, expect } from 'bun:test';
import {
  RiskClass,
  resolveRiskClass,
} from '../../src/permission/types/RiskClass.js';
import { deriveToolRiskClass } from '../../src/tools/toolRiskClass.js';
import { PDFTool } from '../../src/tools/PDFTool/PDFTool.js';
import { FileReadTool } from '../../src/tools/FileReadTool/FileReadTool.js';
import { FileWriteTool } from '../../src/tools/FileWriteTool/FileWriteTool.js';
import { BashTool } from '../../src/tools/bash/BashTool.js';
import { PermissionChecker } from '../../src/permission/PermissionChecker.js';
import { RuleManager } from '../../src/permission/RuleManager.js';
import { PermissionDecisionType } from '../../src/permission/types/PermissionDecision.js';

describe('PR-0：工具声明式风险（混合工具）', () => {
  it('pdf：extract / info 判 read，generate 判 write', () => {
    const pdf = new PDFTool();
    expect(deriveToolRiskClass(pdf, { action: 'extract' })).toBe('read');
    expect(deriveToolRiskClass(pdf, { action: 'info' })).toBe('read');
    expect(deriveToolRiskClass(pdf, { action: 'generate' })).toBe('write');
    // 缺省 action 不应被当成生成（保守按只读分支之外的默认声明处理）
    expect(resolveRiskClass(pdf, { action: 'extract' })).toBe(RiskClass.READ);
    expect(resolveRiskClass(pdf, { action: 'generate' })).toBe(
      RiskClass.WRITE_LOCAL
    );
  });

  it('结构化派生：只读工具 read / 写工具 write / 命令 shell', () => {
    expect(deriveToolRiskClass(new FileReadTool(), {})).toBe('read');
    expect(deriveToolRiskClass(new FileWriteTool(), {})).toBe('write');
    expect(deriveToolRiskClass(new BashTool(), { command: 'dir' })).toBe(
      'shell'
    );
  });

  it('未声明的工具 ⇒ undeclared（不按名字猜、也不放行）', () => {
    expect(deriveToolRiskClass({ name: 'totally_unknown_tool' }, {})).toBe(
      'undeclared'
    );
    expect(resolveRiskClass({ name: 'totally_unknown_tool' }, {})).toBe(
      RiskClass.UNDECLARED
    );
  });

  it('只传工具名（过渡调用方）⇒ 沿用旧启发式，行为零变更', () => {
    expect(resolveRiskClass('pdf', {})).toBe(RiskClass.SHELL);
    expect(resolveRiskClass('file_read', {})).toBe(RiskClass.READ);
  });
});

describe('PR-0：权限裁决接入声明式风险', () => {
  /** 最小工具桩：只带风险声明（避免触发 `checkPermissions` 的既有类型混用路径） */
  const pdfLike = {
    name: 'pdf',
    riskClassFor: (input: Record<string, unknown>): 'read' | 'write' =>
      input?.action === 'generate' ? 'write' : 'read',
    isReadOnly: (input?: Record<string, unknown>): boolean =>
      input?.action !== 'generate',
  };

  it('pdf extract ⇒ allow；pdf generate ⇒ ask', async () => {
    const checker = new PermissionChecker(new RuleManager());

    const readDecision = await checker.checkPermission(
      pdfLike as never,
      { action: 'extract' },
      { toolName: 'pdf', input: { action: 'extract' } } as never
    );
    expect(readDecision.type).toBe(PermissionDecisionType.ALLOW);

    const writeDecision = await checker.checkPermission(
      pdfLike as never,
      { action: 'generate' },
      { toolName: 'pdf', input: { action: 'generate' } } as never
    );
    expect(writeDecision.type).toBe(PermissionDecisionType.ASK);
  });

  it('未声明风险的未知工具 ⇒ ask（不静默放行）', async () => {
    const checker = new PermissionChecker(new RuleManager());
    const decision = await checker.checkPermission(
      { name: 'totally_unknown_tool' } as never,
      {},
      { toolName: 'totally_unknown_tool', input: {} } as never
    );
    expect(decision.type).toBe(PermissionDecisionType.ASK);
    expect(decision.reason).toContain('undeclared');
  });
});
