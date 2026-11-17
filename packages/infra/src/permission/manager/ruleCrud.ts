// MIT License
// Copyright (c) 2026 190615273@qq.com
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
 * 工具规则 CRUD 的**带校验写入**（R2，2026-11-17；治理方案 §11.6）
 *
 * 写入口只有 `/v1/permissions/rules`，本模块是它的唯一校验/落盘内核（handler 只做
 * 参数解析与状态码映射）。四条硬约束：
 * 1. **损坏即只读**：规则文件不可解析时拒绝任何写入（一次写就会覆盖最后可用数据）；
 * 2. **冲突显式**：同键不同行为 ⇒ 询问式拒绝；`force` 可覆盖，但**不得**覆盖审批生成的
 *    规则（那类规则只可撤销，避免把"临时放行"洗成"永久白名单"）；
 * 3. **审批字段不可手写**：`inputFingerprint` / `workspaceRoot` 只由审批卡产生，
 *    新写/编辑一律拒绝（调用方在 handler 侧先拦一次，这里是纵深防御）；
 * 4. **可审计**：每次成功写入都记 `permission:rule_added|rule_updated|rule_removed`
 *    （`rule_updated` 带 before/after；`rule_removed` 标出是否为撤销审批放行）。
 */
import { getLogger } from '@openliri/infra/monitoring';

import type { RuleManager } from '../RuleManager';
import { findConflictingRules, findDuplicateRules } from '../RuleManager';
import {
  PermissionBehavior,
  PermissionRuleSource,
  createPermissionRule,
  isApprovalOriginatedRule,
  type PermissionRule,
} from '../types/PermissionRule';

const logger = getLogger('permission:ruleCrud');

/** 写入失败原因（handler 据此映射 400/403/404/409） */
export type RuleWriteErrorCode =
  | 'invalid'
  | 'corrupted'
  | 'conflict'
  | 'duplicate'
  | 'not-found'
  | 'readonly';

export type RuleWriteResult =
  | { ok: true; rule: PermissionRule }
  | {
      ok: false;
      code: RuleWriteErrorCode;
      message: string;
      /** 冲突时给出被挡住的既有规则（UI 可直接展示） */
      conflicts?: PermissionRule[];
    };

export interface AddRuleInput {
  behavior: PermissionBehavior;
  toolName: string;
  contentPattern?: string;
  /** 用户显式确认「后写为准」（不能覆盖审批生成规则） */
  force?: boolean;
}

export interface UpdateRulePatch {
  behavior?: PermissionBehavior;
  /** `null` = 清除内容条件（变成工具级规则）；`undefined` = 不修改 */
  contentPattern?: string | null;
}

/** 规则文件不可解析 ⇒ 拒绝写入（损坏时任何 save 都会覆盖最后可用数据） */
function checkWritable(ruleManager: RuleManager): RuleWriteResult | null {
  const health = ruleManager.getRuleFileHealth();
  if (health.parseError === null) return null;
  return {
    ok: false,
    code: 'corrupted',
    message: `规则文件不可解析（${health.parseError}），已拒绝写入以免覆盖最后可用数据；请先修复或从 .bak 恢复`,
  };
}

/** 冲突/重复的**公共判定**（调用方已排除自身 id） */
function checkCollisions(
  ruleManager: RuleManager,
  candidate: {
    toolName: string;
    contentPattern?: string;
    inputFingerprint?: string;
    workspaceRoot?: string;
    behavior: PermissionBehavior;
  },
  options: { excludeId?: string; force?: boolean }
): RuleWriteResult | null {
  const rules = ruleManager.getRules();
  const duplicates = findDuplicateRules(rules, candidate, {
    ...(options.excludeId ? { excludeId: options.excludeId } : {}),
  });
  if (duplicates.length > 0) {
    return {
      ok: false,
      code: 'duplicate',
      message: '已存在同键同行为的规则（无需重复添加）',
      conflicts: duplicates,
    };
  }

  const conflicts = findConflictingRules(rules, candidate, {
    ...(options.excludeId ? { excludeId: options.excludeId } : {}),
  });
  if (conflicts.length === 0) return null;

  const approvalConflicts = conflicts.filter((rule) =>
    isApprovalOriginatedRule(rule)
  );
  if (approvalConflicts.length > 0) {
    return {
      ok: false,
      code: 'conflict',
      message:
        '同键规则由审批生成（只可撤销、不可覆盖）；请先删除该审批规则，或改用不同的匹配条件',
      conflicts: approvalConflicts,
    };
  }
  if (!options.force) {
    return {
      ok: false,
      code: 'conflict',
      message: '同键已存在不同行为；如确认「后写为准」，请带 force=true 重试',
      conflicts,
    };
  }
  // force 由 `RuleManager.addRule` 的「同键异行为 ⇒ 后写为准」完成（会删除冲突项）
  return null;
}

/** 新增工具规则（带冲突/损坏校验 + 审计） */
export function addRuleChecked(
  ruleManager: RuleManager,
  input: AddRuleInput
): RuleWriteResult {
  const blocked = checkWritable(ruleManager);
  if (blocked) return blocked;

  const toolName = input.toolName?.trim() ?? '';
  if (!toolName) {
    return { ok: false, code: 'invalid', message: 'toolName 不能为空' };
  }
  const contentPattern = input.contentPattern || undefined;
  const candidate = { behavior: input.behavior, toolName, contentPattern };

  const collision = checkCollisions(ruleManager, candidate, {
    ...(input.force !== undefined ? { force: input.force } : {}),
  });
  if (collision) return collision;

  const rule = createPermissionRule({
    behavior: input.behavior,
    toolName,
    ...(contentPattern !== undefined ? { contentPattern } : {}),
    source: PermissionRuleSource.RULE_STORE,
  });
  ruleManager.addRule(rule);
  logger.info('permission:rule_added', {
    ruleId: rule.id,
    behavior: rule.behavior,
    toolName: rule.toolName,
    contentPattern: rule.contentPattern,
    forced: input.force === true,
  });
  return { ok: true, rule };
}

/**
 * 编辑工具规则（只允许改 `behavior` / `contentPattern`）。
 *
 * 审批生成的规则（指纹 / 本工作区信任）**不可编辑** —— 只能 DELETE 撤销。
 */
export function updateRuleChecked(
  ruleManager: RuleManager,
  ruleId: string,
  patch: UpdateRulePatch
): RuleWriteResult {
  const blocked = checkWritable(ruleManager);
  if (blocked) return blocked;

  // getRules() 会先做一次外部修改检测（30s 惰性轮询），保证改的是最新规则
  const rules = ruleManager.getRules();
  const existing = rules.find((rule) => rule.id === ruleId);
  if (!existing) {
    return { ok: false, code: 'not-found', message: `规则不存在：${ruleId}` };
  }
  if (isApprovalOriginatedRule(existing)) {
    return {
      ok: false,
      code: 'readonly',
      message: '审批生成的规则不可编辑（可删除以撤销放行）',
    };
  }

  const nextBehavior = patch.behavior ?? existing.behavior;
  // ⚠️ 不做 trim：`contentPattern` 常以空格收尾（如 `'^git '`）以区分 `github`，
  // 去空白会把"前缀"放宽成"任意后缀"（安全语义变更）。
  const nextContentPattern =
    patch.contentPattern === undefined
      ? existing.contentPattern
      : patch.contentPattern || undefined;

  const collision = checkCollisions(
    ruleManager,
    {
      behavior: nextBehavior,
      toolName: existing.toolName,
      contentPattern: nextContentPattern,
      ...(existing.inputFingerprint
        ? { inputFingerprint: existing.inputFingerprint }
        : {}),
      ...(existing.workspaceRoot
        ? { workspaceRoot: existing.workspaceRoot }
        : {}),
    },
    { excludeId: existing.id }
  );
  if (collision) return collision;

  const before = {
    behavior: String(existing.behavior),
    contentPattern: existing.contentPattern ?? null,
  };
  const updated: PermissionRule = {
    ...existing,
    behavior: nextBehavior,
    contentPattern: nextContentPattern,
  };
  ruleManager.updateRule(updated);
  logger.info('permission:rule_updated', {
    ruleId,
    before,
    after: {
      behavior: String(nextBehavior),
      contentPattern: nextContentPattern ?? null,
    },
  });
  return { ok: true, rule: updated };
}

/** 删除/撤销工具规则（审批规则走本入口撤销；审计标出是否为撤销放行） */
export function removeRuleChecked(
  ruleManager: RuleManager,
  ruleId: string
): RuleWriteResult {
  const blocked = checkWritable(ruleManager);
  if (blocked) return blocked;

  const rules = ruleManager.getRules();
  const existing = rules.find((rule) => rule.id === ruleId);
  if (!existing) {
    return { ok: false, code: 'not-found', message: `规则不存在：${ruleId}` };
  }
  ruleManager.removeRule(existing);
  logger.info('permission:rule_removed', {
    ruleId,
    behavior: String(existing.behavior),
    toolName: existing.toolName,
    contentPattern: existing.contentPattern,
    inputFingerprint: existing.inputFingerprint,
    workspaceRoot: existing.workspaceRoot,
    revocation: isApprovalOriginatedRule(existing),
  });
  return { ok: true, rule: existing };
}
