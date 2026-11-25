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
import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';
import { isCommandToolName } from '@openliri/infra/utils/toolContract/toolRoles';

import type { RuleManager } from '../RuleManager';
import { findConflictingRules, findDuplicateRules } from '../RuleManager';
import { getApprovedCommandRegistry } from '../ApprovedCommandRegistry';
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
  | 'readonly'
  /** R2b：危险命令头禁止建 allow（403） */
  | 'dangerous'
  /** R2b：allow 规则数超预算（409） */
  | 'budget';

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

/** allow 规则预算的配置键（`config.json#permission.userRuleAllowBudget`） */
export const USER_RULE_ALLOW_BUDGET_KEY = 'permission.userRuleAllowBudget';

/** 默认 allow 预算（超限须显式提高配置，且留审计） */
export const DEFAULT_USER_RULE_ALLOW_BUDGET = 50;

/** 预算上限（防误配成天文数字后彻底失去护栏意义） */
const MAX_USER_RULE_ALLOW_BUDGET = 1000;

const VALID_BEHAVIORS: readonly string[] = ['allow', 'deny', 'ask'];

/**
 * 当前生效的 allow 预算（缺失 / 脏值 / 越界 ⇒ 默认值）。
 *
 * 读 `permission.userRuleAllowBudget`；不做写回，用户显式配置才有意义。
 */
export function readUserRuleAllowBudget(): number {
  const raw = configManager.getConfigValue<unknown>(USER_RULE_ALLOW_BUDGET_KEY);
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_USER_RULE_ALLOW_BUDGET;
  }
  const rounded = Math.round(raw);
  if (rounded < 1 || rounded > MAX_USER_RULE_ALLOW_BUDGET) {
    return DEFAULT_USER_RULE_ALLOW_BUDGET;
  }
  return rounded;
}

/** 计入预算的 allow 规则：排除审批卡生成的持久化放行（那类只可撤销，不算用户预算） */
export function countUserAllowRules(rules: PermissionRule[]): number {
  return rules.filter(
    (rule) =>
      rule.behavior === PermissionBehavior.ALLOW &&
      !isApprovalOriginatedRule(rule)
  ).length;
}

// 2026-11-25：命令头/危险词表判据下沉到 `commandPatterns`（供审批写入与 registry 共用，
// 避免 ruleCrud → registry 的反向依赖成环）；此处原地转出，保持既有导出面不变。
import {
  extractCommandHead,
  findDangerousCommandHead,
} from '../commandPatterns';
export { extractCommandHead, findDangerousCommandHead } from '../commandPatterns';


/**
 * allow 写入的两道护栏（R2b）：危险命令头禁止建 allow + allow 预算。
 *
 * 只作用于**命令类工具**的 allow：`deny` / `ask` 不受限（收紧永远允许）；
 * 非命令工具（`file_write` 等）不适用命令头判定。工具级 allow（无 `contentPattern`）
 * 视为用户显式信任整个工具，不在命令头判据内（设置页可见、可撤销）。
 */
function checkAllowGuards(
  ruleManager: RuleManager,
  input: {
    behavior: PermissionBehavior;
    toolName: string;
    contentPattern?: string;
  },
  options: { skipBudget?: boolean } = {}
): RuleWriteResult | null {
  if (input.behavior !== PermissionBehavior.ALLOW) return null;

  if (isCommandToolName(input.toolName) && input.contentPattern) {
    const dangerous = findDangerousCommandHead(input.contentPattern);
    if (dangerous) {
      return {
        ok: false,
        code: 'dangerous',
        message: `「${dangerous}」属危险命令头，不能建立 allow 规则；请改用 deny / ask，或把 allow 收窄到不含该命令头的具体子命令`,
      };
    }
  }

  if (options.skipBudget) return null;
  const budget = readUserRuleAllowBudget();
  const used = countUserAllowRules(ruleManager.getRules());
  if (used >= budget) {
    logger.warn('permission:allow_budget_exceeded', {
      used,
      budget,
      configKey: USER_RULE_ALLOW_BUDGET_KEY,
      toolName: input.toolName,
      contentPattern: input.contentPattern,
    });
    return {
      ok: false,
      code: 'budget',
      message: `allow 规则已达预算上限（${used}/${budget}）；如确需更多，请显式提高配置 ${USER_RULE_ALLOW_BUDGET_KEY} 后重试`,
    };
  }
  return null;
}

export interface UpdateRulePatch {
  behavior?: PermissionBehavior;
  /** `null` = 清除内容条件（变成工具级规则）；`undefined` = 不修改 */
  contentPattern?: string | null;
}

/** 规则文件不可解析 ⇒ 拒绝写入（损坏时任何 save 都会覆盖最后可用数据） */
function checkWritable(
  ruleManager: RuleManager
): Extract<RuleWriteResult, { ok: false }> | null {
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

  // R2b：危险命令头禁止建 allow + allow 预算（重复/冲突先报，提示更具体）
  const guard = checkAllowGuards(ruleManager, candidate);
  if (guard) return guard;

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

  // R2b：把 ask/deny 改成 allow 同样受两道护栏约束（否则"先建 ask 再改 allow"可绕过）
  const guard = checkAllowGuards(
    ruleManager,
    {
      behavior: nextBehavior,
      toolName: existing.toolName,
      contentPattern: nextContentPattern,
    },
    // 本来就是 allow 的规则不重复占预算（只改内容条件）
    { skipBudget: existing.behavior === PermissionBehavior.ALLOW }
  );
  if (guard) return guard;

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

/**
 * 删除/撤销工具规则（审批规则走本入口撤销；审计标出是否为撤销放行）
 *
 * R3：撤销审批生成的规则时，**同时**清掉该命令在会话放行缓存里的条目
 * （`approvalCommandHash` 由审批写入点记录）—— 否则会出现"规则删了、本次会话仍在放行"。
 */
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
  const clearedApprovalCache =
    isApprovalOriginatedRule(existing) && existing.approvalCommandHash
      ? getApprovedCommandRegistry().revokeByCommandHash(
          existing.approvalCommandHash
        )
      : 0;
  logger.info('permission:rule_removed', {
    ruleId,
    behavior: String(existing.behavior),
    toolName: existing.toolName,
    contentPattern: existing.contentPattern,
    inputFingerprint: existing.inputFingerprint,
    workspaceRoot: existing.workspaceRoot,
    origin: existing.origin,
    revocation: isApprovalOriginatedRule(existing),
    clearedApprovalCache,
  });
  return { ok: true, rule: existing };
}

/** 导入条目（只允许可手写的三字段；审批生成字段不得经导入伪造） */
export interface RuleImportEntry {
  behavior: PermissionBehavior;
  toolName: string;
  contentPattern?: string;
}

export type RuleImportResult =
  | { ok: true; imported: PermissionRule[]; skipped: number }
  | {
      ok: false;
      code: RuleWriteErrorCode;
      message: string;
      conflicts?: PermissionRule[];
      /** 出错条目在 `rules` 数组里的下标（0 起） */
      index?: number;
    };

/** 校验单条导入条目（返回错误文案或规范化条目） */
function parseImportEntry(
  raw: unknown,
  index: number
): { ok: true; entry: RuleImportEntry } | { ok: false; message: string } {
  const label = `第 ${index + 1} 条`;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: `${label}必须是对象` };
  }
  const record = raw as Record<string, unknown>;
  for (const field of ['inputFingerprint', 'workspaceRoot'] as const) {
    if (record[field] !== undefined) {
      return {
        ok: false,
        message: `${label}不得包含 ${field}（审批卡生成，不可导入）`,
      };
    }
  }
  const behavior = record['behavior'];
  if (typeof behavior !== 'string' || !VALID_BEHAVIORS.includes(behavior)) {
    return { ok: false, message: `${label}的 behavior 必须为 allow/deny/ask` };
  }
  const toolName =
    typeof record['toolName'] === 'string' ? record['toolName'].trim() : '';
  if (!toolName) return { ok: false, message: `${label}的 toolName 不能为空` };
  const rawPattern = record['contentPattern'];
  if (rawPattern !== undefined && typeof rawPattern !== 'string') {
    return { ok: false, message: `${label}的 contentPattern 必须是字符串` };
  }
  return {
    ok: true,
    entry: {
      behavior: behavior as PermissionBehavior,
      toolName,
      ...(typeof rawPattern === 'string' && rawPattern
        ? { contentPattern: rawPattern }
        : {}),
    },
  };
}

/**
 * 批量导入工具规则（R2b）：**先全量校验，再一次性落盘**。
 *
 * - 重复（同键同行为，含批内重复）⇒ **跳过**并计数，不报错；
 * - 冲突（同键不同行为）⇒ 409，`conflicts` 带出既有规则，**零写入**；
 * - 非法条目 / 危险命令头 / allow 预算超限 ⇒ 400 / 403 / 409，**零写入**。
 */
export function importRulesChecked(
  ruleManager: RuleManager,
  entries: unknown
): RuleImportResult {
  const blocked = checkWritable(ruleManager);
  if (blocked) return blocked;

  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, code: 'invalid', message: 'rules 必须是非空数组' };
  }

  const candidates: RuleImportEntry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const parsed = parseImportEntry(entries[index], index);
    if (!parsed.ok) {
      return { ok: false, code: 'invalid', message: parsed.message, index };
    }
    candidates.push(parsed.entry);
  }

  // 全量校验阶段：危险命令头（预算按整批新增数一次判定，见下）
  for (let index = 0; index < candidates.length; index += 1) {
    const guard = checkAllowGuards(ruleManager, candidates[index]!, {
      skipBudget: true,
    });
    if (guard && !guard.ok) {
      return { ...guard, message: `第 ${index + 1} 条：${guard.message}`, index };
    }
  }

  const planned = [...ruleManager.getRules()];
  const imported: PermissionRule[] = [];
  let skipped = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const entry = candidates[index]!;
    if (findDuplicateRules(planned, entry).length > 0) {
      skipped += 1;
      continue;
    }
    const conflicts = findConflictingRules(planned, entry);
    if (conflicts.length > 0) {
      return {
        ok: false,
        code: 'conflict',
        message: `第 ${index + 1} 条与既有规则同键不同行为（导入不覆盖既有规则，请先删除冲突项）`,
        conflicts,
        index,
      };
    }
    const rule = createPermissionRule({
      behavior: entry.behavior,
      toolName: entry.toolName,
      ...(entry.contentPattern !== undefined
        ? { contentPattern: entry.contentPattern }
        : {}),
      source: PermissionRuleSource.RULE_STORE,
    });
    planned.push(rule);
    imported.push(rule);
  }

  const allowToAdd = imported.filter(
    (rule) => rule.behavior === PermissionBehavior.ALLOW
  ).length;
  if (allowToAdd > 0) {
    const budget = readUserRuleAllowBudget();
    const used = countUserAllowRules(ruleManager.getRules());
    if (used + allowToAdd > budget) {
      logger.warn('permission:allow_budget_exceeded', {
        used,
        incoming: allowToAdd,
        budget,
        configKey: USER_RULE_ALLOW_BUDGET_KEY,
        source: 'import',
      });
      return {
        ok: false,
        code: 'budget',
        message: `导入后 allow 规则将达 ${used + allowToAdd} 条，超过预算 ${budget}；请减少导入或显式提高配置 ${USER_RULE_ALLOW_BUDGET_KEY}`,
      };
    }
  }

  if (imported.length > 0) ruleManager.saveRules(planned);
  logger.info('permission:rules_imported', {
    imported: imported.length,
    skipped,
  });
  return { ok: true, imported, skipped };
}
