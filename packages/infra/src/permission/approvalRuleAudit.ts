// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 审批放行规则的**风险巡检**（纯函数，2026-11-25）。
 *
 * 背景：历史审批卡写入的 `contentPattern` 曾出现两类放大：
 *  - 解释器/壳内建按首 token 前缀（`^powershell -Command.*` / `^cd /d.*`）⇒ 任意参数/复合命令免审批；
 *  - 危险命令头前缀（`^git push.*` ⇒ `--force / --mirror`）。
 *
 * 本模块只做**分类**（不读盘、不删规则）：
 *  - `high`：解释器/壳内建前缀、危险命令头前缀、命令类工具整工具放行；
 *  - `review`：无法解析命令头 / 非只读命令的可变前缀；
 *  - `low`：只读命令前缀（`dir` / `ls` …，无副作用）；
 *  - `ok`：精确匹配（`^…$`）、按参数指纹、非命令类工具。
 *
 * CLI 入口见 `app/scripts/audit-approval-rules.ts`（`bun run audit:approval-rules`）。
 */

import {
  extractCommandHead,
  extractCommandHeadToken,
  findDangerousCommandHead,
  isInterpreterCommandHead,
  isShellBuiltinCommandHead,
  normalizeCommandHead,
} from './commandPatterns';
import type { PermissionRule } from './types/PermissionRule';
import { resolveRuleOrigin } from './types/PermissionRule';
// 只读命令唯一事实源（lint:permission-single-source 禁止另写一份）
import { READ_ONLY_BASE_COMMANDS } from '../security/readOnlyCommands';

/** 巡检风险等级（高 → 低排序） */
export type ApprovalRuleRiskLevel = 'high' | 'review' | 'low' | 'ok';

/** 巡检结果行（可序列化，供 CLI `--json` 输出） */
export interface AuditedApprovalRule {
  id: string;
  toolName: string;
  pattern: string;
  level: ApprovalRuleRiskLevel;
  kind: string;
  /** 前缀形态的命令头（精确/指纹规则为空串） */
  head: string;
  hitCount: number;
  origin: string;
  approvedAt?: string;
}

export interface ApprovalRuleAuditReport {
  /** 规则文件中的总条数（不是 allow 的也计入） */
  total: number;
  /** 参与巡检的条目（命令类工具的 allow） */
  audited: AuditedApprovalRule[];
  counts: Record<ApprovalRuleRiskLevel, number>;
  /** 需要处置的条目（level === 'high'） */
  high: AuditedApprovalRule[];
}

/** 只读命令头（前缀放行属低风险；唯一事实源：`security/readOnlyCommands`） */
const READ_ONLY_HEADS: ReadonlySet<string> = READ_ONLY_BASE_COMMANDS;

/** 命令类工具（与 `toolRoles.isCommandToolName` 同口径的最小集合） */
const COMMAND_TOOL_NAMES: ReadonlySet<string> = new Set([
  'bash',
  'powershell',
  'pwsh',
]);

function isCommandTool(toolName: string): boolean {
  return COMMAND_TOOL_NAMES.has(toolName);
}

/** 巡检输入：规则本体 + 可选的命中计数（由调用方从 `rule_hits.json` 合并） */
export type AuditRuleInput = PermissionRule & { hitCount?: number };

/**
 * 分类单条规则；非"命令类工具的 allow" ⇒ `null`（不参与巡检）。
 */
export function classifyApprovalRule(
  rule: AuditRuleInput
): AuditedApprovalRule | null {
  if (String(rule.behavior) !== 'allow' || !isCommandTool(rule.toolName)) {
    return null;
  }
  const pattern = rule.contentPattern ?? '';
  const base = {
    id: rule.id,
    toolName: rule.toolName,
    pattern: pattern || '(tool-level)',
    hitCount: Number(rule.hitCount ?? 0),
    origin: resolveRuleOrigin(rule),
    ...(rule.approvedAt
      ? { approvedAt: new Date(rule.approvedAt).toISOString() }
      : {}),
  };

  // 按参数指纹（"始终允许此调用"）⇒ 已收窄到单次调用，不放大
  if (!pattern && rule.inputFingerprint) {
    return { ...base, level: 'ok', kind: '参数指纹', head: '' };
  }
  // 无内容条件的工具级 allow：整个工具免审批（命令类属高危）
  if (!pattern) {
    return { ...base, level: 'high', kind: '整工具放行', head: '' };
  }
  // 精确匹配 / 非前缀写法 ⇒ 不放大
  if (!pattern.endsWith('.*')) {
    return {
      ...base,
      level: 'ok',
      kind: pattern.endsWith('$') ? '精确匹配' : '非前缀',
      head: '',
    };
  }

  const headText = extractCommandHead(pattern) ?? '';
  const head = normalizeCommandHead(extractCommandHeadToken(headText));
  if (!head) {
    return { ...base, level: 'review', kind: '无法解析命令头', head: '' };
  }
  if (isInterpreterCommandHead(head) || isShellBuiltinCommandHead(head)) {
    return { ...base, level: 'high', kind: '解释器/壳内建前缀', head };
  }
  if (findDangerousCommandHead(pattern)) {
    return { ...base, level: 'high', kind: '危险命令头前缀', head };
  }
  if (READ_ONLY_HEADS.has(head)) {
    return { ...base, level: 'low', kind: '只读命令前缀', head };
  }
  return { ...base, level: 'review', kind: '非只读可变前缀', head };
}

/** 巡检一批规则（按 high → review → low → ok 排序，同级按 id 稳定） */
export function auditApprovalRules(
  rules: readonly AuditRuleInput[]
): ApprovalRuleAuditReport {
  const levels: ApprovalRuleRiskLevel[] = ['high', 'review', 'low', 'ok'];
  const audited: AuditedApprovalRule[] = [];
  for (const rule of rules) {
    const row = classifyApprovalRule(rule);
    if (row) audited.push(row);
  }
  audited.sort((a, b) => {
    const d = levels.indexOf(a.level) - levels.indexOf(b.level);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
  const counts: Record<ApprovalRuleRiskLevel, number> = {
    high: 0,
    review: 0,
    low: 0,
    ok: 0,
  };
  for (const row of audited) counts[row.level] += 1;
  return {
    total: rules.length,
    audited,
    counts,
    high: audited.filter((row) => row.level === 'high'),
  };
}
