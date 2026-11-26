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
 * permission-handlers.ts — 工具权限规则管理 HTTP handler（P1-5）
 *
 * 暴露 GET/POST/DELETE /v1/permissions/rules，
 * 复用主 PermissionManager（A 体系）的规则 CRUD，
 * 数据落盘 permissions/tool_rules.json（P1-6 存储统一）。
 */

import type http from 'http';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { sendError, readRequestBody, broadcastEvent } from './handler-utils';
import {
  PermissionBehavior,
  PermissionRule,
  describePermissionRuleScope,
  isApprovalOriginatedRule,
} from '@openliri/infra/permission/types/PermissionRule';
import {
  shadowedRuleDetector,
  permissionMetrics,
  PermissionManager,
  addRuleChecked,
  updateRuleChecked,
  removeRuleChecked,
  importRulesChecked,
  countUserAllowRules,
  readUserRuleAllowBudget,
  readCommandRulesConfig,
  readApprovalPauseState,
  setApprovalPauseState,
  APPROVAL_PAUSE_CONFIG_KEY,
  readUnknownCommandDigest,
  getRuleHitEntry,
  readRuleHitStats,
  buildRuleHitReport,
  SIMULATABLE_PERMISSION_MODES,
  isSimulatablePermissionMode,
  type CommandRulesSettings,
  type RuleWriteResult,
  type SimulatablePermissionMode,
  type RuleImpactPreview,
} from '@openliri/infra/permission';

const VALID_BEHAVIORS: string[] = ['allow', 'deny', 'ask'];

/**
 * 序列化规则（Date → ISO 字符串，供 JSON 传输）。
 *
 * R0（2026-11-17，治理方案 §3.2/§3.3）：补 `scope` 与 `readOnly` —— 两者都是**派生字段**，
 * 不落盘、不改判定语义：
 * - `scope`：按匹配条件推导（见 `describePermissionRuleScope`）；
 * - `readOnly`：审批卡生成的持久化放行（指纹 / 本工作区信任）不可编辑、只能撤销。
 */
export function serializeRule(rule: PermissionRule): Record<string, unknown> {
  const approvalOriginated = isApprovalOriginatedRule(rule);
  // 审批时间：显式 approvedAt 优先，旧规则回落 createdAt；非审批规则 ⇒ null
  const approvedAt = approvalOriginated
    ? (rule.approvedAt ?? rule.createdAt)
    : null;
  // R5：按规则维度的命中统计（决策链真实判定写入；从未命中 ⇒ 0 / null）
  const hit = getRuleHitEntry(rule.id);
  return {
    id: rule.id,
    behavior: rule.behavior,
    toolName: rule.toolName,
    contentPattern: rule.contentPattern,
    // PR-2（2026-10-23）：「始终允许」规则（工具 + 参数指纹）—— 前端据此展示/撤销，
    // 只暴露摘要（32 hex），原始参数从未落库
    inputFingerprint: rule.inputFingerprint,
    // G3（2026-11-14）：「本工作区永久信任」的作用域根
    workspaceRoot: rule.workspaceRoot,
    source: rule.source,
    // R0：作用域（session | workspace | tool | global）与只读标记
    scope: describePermissionRuleScope(rule),
    readOnly: approvalOriginated,
    // R3（2026-11-17）：来源侧（审批生成 / 用户手建）+ 审批分组字段
    origin: approvalOriginated ? 'approval' : 'user',
    approvedAt:
      approvedAt instanceof Date
        ? approvedAt.toISOString()
        : (approvedAt ?? null),
    // 如实：审批记录未保存批准者身份（本地审批无身份字段）⇒ null，不编造
    approvedBy: null,
    // R5：命中次数 / 最近命中（决策链真实判定计数；从未命中 ⇒ 0 / null）
    hitCount: hit?.count ?? 0,
    lastHitAt: hit ? new Date(hit.lastHitAt).toISOString() : null,
    priority: rule.priority,
    createdAt:
      rule.createdAt instanceof Date
        ? rule.createdAt.toISOString()
        : rule.createdAt,
    updatedAt:
      rule.updatedAt instanceof Date
        ? rule.updatedAt.toISOString()
        : rule.updatedAt,
  };
}

/**
 * B 体系命令规则的**只读视图**（R1.5，2026-11-17）。
 *
 * 为什么必须出现在治理视图里（评审 P0-2）：`permission.customRules.commandRules`
 * 是**第三套在生效**的命令规则存储（`commandRulePolicy` / `checkCommandCustomRules`
 * 在 bash / powershell 判定链生效），只展示 `tool_rules.json` 会让用户以为"没配规则"。
 *
 * 只读：写入口仍是 `PUT /v1/config/permission`（B 体系），本期不迁移、不双写。
 */
export function buildCommandRulesView(
  settings: CommandRulesSettings | undefined
): Record<string, unknown> | null {
  if (!settings) return null;
  return {
    readOnly: true,
    source: 'commandRules',
    mode: settings.mode,
    blacklist: settings.blacklist,
    whitelist: settings.whitelist,
    note: 'B 体系命令级策略（config.json#permission.customRules.commandRules）；只读展示，写入仍走 PUT /v1/config/permission',
  };
}

/**
 * 列出工具权限规则 GET /v1/permissions/rules
 * 附带影子规则（遮蔽冲突）检测结果：deny 被更宽泛规则遮蔽时提示，防止权限配置漏洞
 */
export async function handleListPermissionRules(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const manager = PermissionManager.getInstance();
    const rules = manager.getRules() as PermissionRule[];
    const summary = manager.getRulesSummary();
    const shadowDetection = shadowedRuleDetector.detect(rules);
    // PR-2（2026-10-23）合并视图（方案 §3.7.2）：并上 settings 来源的规则（只读，带 source），
    // 否则用户在 settings 写了 allow、面板却显示"默认" ⇒ UI 与真实决策不一致。
    const settingsRules = manager.getSettingsRuleEntries().map((r, i) => ({
      id: `settings:${r.source}:${r.behavior}:${i}`,
      behavior: r.behavior,
      toolName: r.toolName,
      contentPattern: r.contentPattern,
      source: r.source,
      // R0：settings 来源同为只读视图，作用域按匹配条件推导（无 workspaceRoot/指纹 ⇒ 工具级或全局）
      scope: describePermissionRuleScope(r),
      priority: 0,
      createdAt: null,
      updatedAt: null,
      readOnly: true,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // R3：审批生成规则的**分组视图**（列表仍保留扁平 `rules`，分组是派生只读视图）
    const approvalRules = rules.filter((rule) =>
      isApprovalOriginatedRule(rule)
    );
    // F2：暂停状态只读一次（避免同一响应里多次读配置）
    const approvalPauseState = readApprovalPauseState();
    res.end(
      JSON.stringify({
        rules: [...rules.map(serializeRule), ...settingsRules],
        summary,
        // R3：来源=审批 的分组（作用域 / 工具 / 指纹摘要 / 审批时间 / 命中次数见各条字段）
        approvalRules: {
          count: approvalRules.length,
          rules: approvalRules.map(serializeRule),
          note: '审批卡生成的持久化放行：只可撤销（DELETE），不可编辑；approvedBy 未落库（如实 null），hitCount 来自规则命中计数',
        },
        // R3：「暂停持久化放行」当前状态（开启后审批规则不参与判定，仍可逐条撤销）
        // F2：`enabled` 保持=全局（旧客户端兼容）；`sessions` / `workspaces` 为细粒度暂停列表
        approvalPause: {
          enabled: approvalPauseState.global,
          global: approvalPauseState.global,
          sessions: approvalPauseState.sessions,
          workspaces: approvalPauseState.workspaces,
          configKey: APPROVAL_PAUSE_CONFIG_KEY,
        },
        // R5：本周未收录命令摘要（设置页提示 + "去添加规则"跳转；无样本 ⇒ null，不编造 0）
        unknownCommandSuggestions: readUnknownCommandDigest({
          sinceDays: 7,
          top: 5,
        }),
        // R1.5：B 体系命令规则（只读；来源=commandRules）—— 不配置时为 null
        commandRules: buildCommandRulesView(readCommandRulesConfig()),
        // R2b：allow 预算用量（超限时写接口 409，前端据此提示"显式提高配置"）
        allowBudget: {
          limit: readUserRuleAllowBudget(),
          used: countUserAllowRules(rules),
        },
        shadowDetection: {
          shadowedCount: shadowDetection.shadowedCount,
          isValid: shadowDetection.isValid,
          suggestions: shadowDetection.suggestions,
          shadowedRules: shadowDetection.shadowedRules.map((s) => ({
            reason: s.reason,
            severity: s.severity,
            shadowingIndex: s.shadowingIndex,
            shadowedRule: serializeRule(s.shadowedRule),
            shadowingRule: serializeRule(s.shadowingRule),
          })),
        },
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/** 写失败 → HTTP 状态码（R2：冲突/损坏/预算 409；危险命令头/只读 403；不存在 404；参数 400） */
function sendRuleWriteFailure(
  res: http.ServerResponse,
  failure: Extract<RuleWriteResult, { ok: false }>
): void {
  const status =
    failure.code === 'not-found'
      ? 404
      : failure.code === 'readonly' || failure.code === 'dangerous'
        ? 403
        : failure.code === 'invalid'
          ? 400
          : 409;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      error: {
        code: failure.code,
        message: failure.message,
        ...(failure.conflicts
          ? { conflicts: failure.conflicts.map(serializeRule) }
          : {}),
      },
    })
  );
}

/**
 * R5：影响预演发现"基准变差" ⇒ 409（**未写任何状态**），需显式 `confirmImpact=true` 重试。
 */
function sendRuleImpactBlocked(
  res: http.ServerResponse,
  impact: RuleImpactPreview
): void {
  res.writeHead(409, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      error: {
        code: 'impact',
        message: `该规则会把 ${impact.degradedCommands.length} 条基准命令从 ask/allow 变为 deny；如确认请带 confirmImpact=true 重试`,
        impact,
      },
    })
  );
}

/** 审批生成字段（`inputFingerprint` / `workspaceRoot`）不得经手写规则伪造 */
function rejectsApprovalFields(body: Record<string, unknown>): string | null {
  for (const field of ['inputFingerprint', 'workspaceRoot'] as const) {
    if (body[field] !== undefined) {
      return `${field} 由审批卡生成，不可手写；请通过审批卡产生或在列表里撤销`;
    }
  }
  return null;
}

/**
 * 添加工具权限规则 POST /v1/permissions/rules
 * body: { behavior: 'allow' | 'deny' | 'ask', toolName: string, contentPattern?: string,
 *         force?: boolean, confirmImpact?: boolean }
 *
 * R2：冲突（同键不同行为）⇒ 409 + `conflicts`；`force=true` 表示「后写为准」，
 * 但**不能**覆盖审批生成的规则。规则文件损坏 ⇒ 409（不覆盖最后可用数据）。
 *
 * R5（§11.6-④）：写前跑基准命令影响预演；若把基准从 ask/allow 变 deny ⇒ 409 + `impact`，
 * 需显式 `confirmImpact=true` 再写（防把自己/agent 锁死）。
 */
export async function handleAddPermissionRule(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const { behavior, toolName, contentPattern, force, confirmImpact } = parsed;

    const approvalFieldError = rejectsApprovalFields(parsed);
    if (approvalFieldError) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: approvalFieldError } }));
      return;
    }
    if (
      typeof toolName !== 'string' ||
      !toolName.trim() ||
      typeof behavior !== 'string' ||
      !VALID_BEHAVIORS.includes(behavior) ||
      (force !== undefined && typeof force !== 'boolean') ||
      (confirmImpact !== undefined && typeof confirmImpact !== 'boolean') ||
      (contentPattern !== undefined && typeof contentPattern !== 'string')
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message:
              'behavior 必须为 allow/deny/ask，toolName 必填字符串；contentPattern 为字符串，force / confirmImpact 为布尔',
          },
        })
      );
      return;
    }

    const manager = PermissionManager.getInstance();
    // R5：保存前冒烟自检（内存沙箱，不写任何状态）
    const impact = await manager.previewRuleImpact({
      behavior: behavior as PermissionBehavior,
      toolName,
      ...(typeof contentPattern === 'string' && contentPattern
        ? { contentPattern }
        : {}),
    });
    if (impact?.degraded && confirmImpact !== true) {
      sendRuleImpactBlocked(res, impact);
      return;
    }

    const result = addRuleChecked(manager.getRuleManager(), {
      behavior: behavior as PermissionBehavior,
      toolName,
      ...(typeof contentPattern === 'string' && contentPattern
        ? { contentPattern }
        : {}),
      ...(force === true ? { force: true } : {}),
    });
    if (!result.ok) {
      sendRuleWriteFailure(res, result);
      return;
    }
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        message: '权限规则已添加',
        rule: serializeRule(result.rule),
        impact,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 编辑工具权限规则 PUT /v1/permissions/rules/{ruleId}（R2）
 *
 * 只允许改 `behavior` / `contentPattern`（`null` = 清除内容条件）；`toolName` 不可改
 * （身份稳定，改工具名请删除后新建）。审批生成的规则 403（可 DELETE 撤销）。
 */
export async function handleUpdatePermissionRule(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ruleId: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const parsed = JSON.parse(body) as Record<string, unknown>;

    if (ruleId.startsWith('settings:')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'settings 来源的规则为只读（请在 settings 文件中修改）',
          },
        })
      );
      return;
    }
    const approvalFieldError = rejectsApprovalFields(parsed);
    if (approvalFieldError) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: approvalFieldError } }));
      return;
    }
    const { behavior, contentPattern, confirmImpact } = parsed;
    if (
      parsed['toolName'] !== undefined ||
      parsed['force'] !== undefined ||
      (confirmImpact !== undefined && typeof confirmImpact !== 'boolean') ||
      (behavior !== undefined &&
        (typeof behavior !== 'string' ||
          !VALID_BEHAVIORS.includes(behavior))) ||
      (contentPattern !== undefined &&
        contentPattern !== null &&
        typeof contentPattern !== 'string')
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message:
              '只允许改 behavior / contentPattern（null 清除）与 confirmImpact；toolName 不可修改；force 仅用于新增',
          },
        })
      );
      return;
    }
    if (behavior === undefined && contentPattern === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: '至少提供 behavior 或 contentPattern 之一' },
        })
      );
      return;
    }

    const manager = PermissionManager.getInstance();
    // R5：编辑同样做影响预演（用"改后"的行为/内容作为候选；规则不存在 ⇒ 交给 updateRuleChecked 报 404）
    const existing = manager
      .getRuleManager()
      .getRules()
      .find((rule) => rule.id === ruleId);
    let impact = null;
    if (existing && !isApprovalOriginatedRule(existing)) {
      impact = await manager.previewRuleImpact({
        behavior:
          (behavior as PermissionBehavior | undefined) ?? existing.behavior,
        toolName: existing.toolName,
        contentPattern:
          contentPattern === undefined
            ? existing.contentPattern
            : (contentPattern as string | null) || undefined,
      });
      if (impact?.degraded && confirmImpact !== true) {
        sendRuleImpactBlocked(res, impact);
        return;
      }
    }

    const result = updateRuleChecked(manager.getRuleManager(), ruleId, {
      ...(typeof behavior === 'string'
        ? { behavior: behavior as PermissionBehavior }
        : {}),
      ...(contentPattern !== undefined
        ? { contentPattern: contentPattern as string | null }
        : {}),
    });
    if (!result.ok) {
      sendRuleWriteFailure(res, result);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        message: '权限规则已更新',
        rule: serializeRule(result.rule),
        impact,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 删除工具权限规则 DELETE /v1/permissions/rules/{ruleId}
 *
 * 审批生成的规则删除 = **撤销持久化放行**（审计里标 `revocation=true`）；
 * 不存在 ⇒ 200 幂等（旧客户端重复删除不报错）；规则文件损坏 ⇒ 409。
 */
export async function handleDeletePermissionRule(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  ruleId: string
): Promise<void> {
  try {
    // PR-2：settings 来源规则是**只读合并视图**（id 前缀 `settings:`），不可经此接口删除 ——
    // 否则会给人"删掉了"的错觉（真实来源在 settings 文件里）。
    if (ruleId.startsWith('settings:')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'settings 来源的规则为只读（请在 settings 文件中修改）',
          },
        })
      );
      return;
    }
    const result = removeRuleChecked(
      PermissionManager.getInstance().getRuleManager(),
      ruleId
    );
    if (!result.ok) {
      if (result.code === 'not-found') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: '权限规则不存在（已幂等处理）' }));
        return;
      }
      sendRuleWriteFailure(res, result);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: '权限规则已删除' }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 规则导出载荷（R2b）。
 *
 * 只含**用户手建**规则：审批卡生成的持久化放行（指纹 / 本工作区信任）**不导出**
 * —— 那类放行绑定本机指纹与路径，回灌到别的环境既无效也容易被误当白名单。
 */
export function buildRulesExport(rules: PermissionRule[]): {
  version: number;
  exportedAt: string;
  rules: Array<{
    behavior: string;
    toolName: string;
    contentPattern?: string;
  }>;
} {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    rules: rules
      .filter((rule) => !isApprovalOriginatedRule(rule))
      .map((rule) => ({
        behavior: String(rule.behavior),
        toolName: rule.toolName,
        ...(rule.contentPattern !== undefined
          ? { contentPattern: rule.contentPattern }
          : {}),
      })),
  };
}

/**
 * 导出工具权限规则 GET /v1/permissions/rules/export（R2b）
 *
 * 只读；返回可直接喂给导入接口的 JSON（备份 / 迁移 / 回滚用）。
 */
export async function handleExportPermissionRules(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const rules = PermissionManager.getInstance()
      .getRuleManager()
      .getRules() as PermissionRule[];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(buildRulesExport(rules)));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 导入工具权限规则 POST /v1/permissions/rules/import（R2b）
 *
 * body: `{ rules: [{ behavior, toolName, contentPattern? }, ...] }`
 *
 * 先**全量校验**再一次性落盘：重复跳过、冲突/非法/危险命令头/预算超限 ⇒ 零写入。
 */
export async function handleImportPermissionRules(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const parsed = JSON.parse(body) as Record<string, unknown> | null;
    const result = importRulesChecked(
      PermissionManager.getInstance().getRuleManager(),
      parsed?.['rules']
    );
    if (!result.ok) {
      sendRuleWriteFailure(res, result);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        message: '权限规则已导入',
        importedCount: result.imported.length,
        imported: result.imported.map(serializeRule),
        skipped: result.skipped,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * F2：细粒度暂停列表（`sessions` / `workspaces`）的通用校验。
 *
 * 只做**形状/规模**校验（字符串数组、单条长度、条数上限）；去重与工作区根归一化
 * 交给 `setApprovalPauseState`（唯一实现，避免两处口径不一致）。
 */
function parsePauseList(
  raw: unknown,
  field: 'sessions' | 'workspaces',
  maxEntryLength: number
): { ok: true; value: string[] } | { ok: false; message: string } {
  if (!Array.isArray(raw) || !raw.every((value) => typeof value === 'string')) {
    return { ok: false, message: `${field} 必须是字符串数组` };
  }
  const values = raw.map((value) => value.trim()).filter(Boolean);
  if (values.some((value) => value.length > maxEntryLength)) {
    return {
      ok: false,
      message: `单个 ${field} 条目不能超过 ${maxEntryLength} 字符`,
    };
  }
  if (values.length > 200) {
    return { ok: false, message: `${field} 最多 200 条` };
  }
  return { ok: true, value: values };
}

/**
 * 「暂停持久化放行」开关 POST /v1/permissions/approvals/pause（R3 落地；F2 粒度细化）
 *
 * body（可组合）：
 * - `{ enabled: boolean }`（旧形状）⇒ 只改**全局**，保留既有会话/工作区级条目；
 * - `{ global?: boolean, sessions?: string[], workspaces?: string[] }` ⇒ 整体写入
 *   （`sessions` = 按会话暂停的 id 列表；`workspaces` = 按工作区根暂停，服务端归一化后落库）。
 *
 * 开启后：① 审批卡不再新增放行规则；② 已存在的审批生成规则不参与判定
 * （规则仍在列表里可见、可逐条撤销）。判定口实时读配置，故只需广播配置变更事件。
 *
 * 如实边界：`sessions` 只按**会话 id 精确匹配**、`workspaces` 只按**归一化后的根相等**匹配；
 * 拿不到会话/工作区上下文的路径（后台/无人值守）只受 `global` 影响，不会被某个会话或
 * 某个工作区的暂停"顺带收紧"。
 */
export async function handleSetApprovalPause(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const parsed = JSON.parse(body) as Record<string, unknown> | null;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '请求体必须是对象' } }));
      return;
    }

    const legacyEnabled = parsed['enabled'];
    const hasGlobal = parsed['global'] !== undefined;
    const hasSessions = parsed['sessions'] !== undefined;
    const hasWorkspaces = parsed['workspaces'] !== undefined;
    if (
      !hasGlobal &&
      !hasSessions &&
      !hasWorkspaces &&
      typeof legacyEnabled !== 'boolean'
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message:
              '必须提供 enabled（布尔）或 global / sessions / workspaces',
          },
        })
      );
      return;
    }

    const current = readApprovalPauseState();
    const global = hasGlobal
      ? parsed['global']
      : typeof legacyEnabled === 'boolean'
        ? legacyEnabled
        : current.global;
    if (typeof global !== 'boolean') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'global 必须是布尔值' } }));
      return;
    }

    const rawSessions = hasSessions ? parsed['sessions'] : current.sessions;
    const sessions = parsePauseList(rawSessions, 'sessions', 128);
    if (!sessions.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: sessions.message } }));
      return;
    }

    const rawWorkspaces = hasWorkspaces
      ? parsed['workspaces']
      : current.workspaces;
    const workspaces = parsePauseList(rawWorkspaces, 'workspaces', 512);
    if (!workspaces.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: workspaces.message } }));
      return;
    }

    const next = setApprovalPauseState({
      global,
      sessions: sessions.value,
      workspaces: workspaces.value,
    });
    broadcastEvent('config:updated', {
      key: APPROVAL_PAUSE_CONFIG_KEY,
      value: next,
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        enabled: next.global,
        global: next.global,
        sessions: next.sessions,
        workspaces: next.workspaces,
        configKey: APPROVAL_PAUSE_CONFIG_KEY,
        message: next.global
          ? '已暂停全部持久化放行（审批生成的规则不再生效，可逐条撤销）'
          : next.sessions.length > 0 || next.workspaces.length > 0
            ? `已按会话暂停 ${next.sessions.length} 个、按工作区暂停 ${next.workspaces.length} 个（其他范围不受影响）`
            : '已恢复持久化放行',
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 权限监测指标快照 GET /v1/permissions/metrics
 *
 * OTel Metrics 为 Push 模型（Console 导出），无法按需查询 Counter 当前值；
 * 此处返回 PermissionMetricsStore 内存快照（与 OTel counter 同步双写，进程内累计）。
 */
export async function handleGetPermissionMetrics(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const metrics = permissionMetrics.snapshot();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        generatedAt: Date.now(),
        total: metrics.reduce((sum, m) => sum + m.count, 0),
        metrics,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 规则文件健康视图 GET /v1/permissions/rules/health（R0，2026-11-17）
 *
 * **纯只读**：不重载、不写文件、不改判定。用于回答"规则文件是否被改过 / 是否损坏 /
 * 是否存在同键不同行为的冲突"—— 这些此前只能翻日志（治理方案 G8）。
 */
export async function handleGetPermissionRulesHealth(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const ruleManager = PermissionManager.getInstance().getRuleManager();
    const health = ruleManager.getRuleFileHealth();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        generatedAt: Date.now(),
        ...health,
        // R5：按规则维度的命中统计 + 「90 天未命中」报告。
        // 观察期不足 90 天 ⇒ `observationComplete: false` 且 `staleRules: []`（不误报）。
        ruleHits: buildRuleHitReport(
          ruleManager.getRules(),
          readRuleHitStats()
        ),
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/** 通过校验后的模拟请求体（失败分支见 `parseSimulateBody` 的 `{ ok: false }`） */
type ParsedSimulateBody = {
  toolName: string;
  input: Record<string, unknown>;
  mode?: SimulatablePermissionMode;
  autonomy?: 'interactive' | 'demand';
  workspaceRoots?: string[];
};

/**
 * 解析并校验模拟请求体。
 *
 * 支持两种写法（R0 单条）：
 * - 命令糖：`{ command: 'git status', toolName?: 'bash' }`（toolName 缺省 `bash`）
 * - 完整入参：`{ toolName: 'file_read', input: { path: '...' } }`
 */
function parseSimulateBody(
  raw: Record<string, unknown>
): { ok: true; value: ParsedSimulateBody } | { ok: false; message: string } {
  const rawToolName =
    typeof raw['toolName'] === 'string' ? raw['toolName'].trim() : '';
  const command =
    typeof raw['command'] === 'string' ? raw['command'] : undefined;
  const rawInput = raw['input'];
  if (
    rawInput !== undefined &&
    (rawInput === null ||
      typeof rawInput !== 'object' ||
      Array.isArray(rawInput))
  ) {
    return { ok: false, message: 'input 必须是对象' };
  }
  const input: Record<string, unknown> = {
    ...((rawInput as Record<string, unknown> | undefined) ?? {}),
  };
  if (command !== undefined) input['command'] = command;
  if (!command && Object.keys(input).length === 0) {
    return { ok: false, message: '必须提供 command 字符串或 input 对象' };
  }
  const toolName = rawToolName || (command !== undefined ? 'bash' : '');
  if (!toolName) {
    return {
      ok: false,
      message: 'toolName 必填（提供 command 时缺省为 bash）',
    };
  }

  const mode = raw['mode'];
  if (
    mode !== undefined &&
    (typeof mode !== 'string' || !isSimulatablePermissionMode(mode))
  ) {
    return {
      ok: false,
      message: `mode 仅支持 ${SIMULATABLE_PERMISSION_MODES.join(' / ')}`,
    };
  }

  const autonomy = raw['autonomy'];
  if (
    autonomy !== undefined &&
    autonomy !== 'interactive' &&
    autonomy !== 'demand'
  ) {
    return { ok: false, message: 'autonomy 仅支持 interactive / demand' };
  }

  const rawRoots = raw['workspaceRoots'];
  if (
    rawRoots !== undefined &&
    (!Array.isArray(rawRoots) ||
      rawRoots.some((root) => typeof root !== 'string'))
  ) {
    return { ok: false, message: 'workspaceRoots 必须是字符串数组' };
  }

  return {
    ok: true,
    value: {
      toolName,
      input,
      ...(mode !== undefined ? { mode } : {}),
      ...(autonomy !== undefined ? { autonomy } : {}),
      ...(rawRoots !== undefined
        ? { workspaceRoots: rawRoots as string[] }
        : {}),
    },
  };
}

/**
 * 只读探查**真实执行链**使用的权限运行时（`CoreAPIImpl.executeTool` 注入的那个实例）。
 *
 * 不为核对去装配它 —— 模拟是只读接口，不能顺手改组合根状态；
 * 组合根尚未就绪（首条对话前）⇒ 返回 `undefined`，由调用方如实标注"无法核对"。
 */
function readRuntimePermissionManager(): unknown {
  try {
    // `ChatManager.getPermissionManager()` 刻意声明为 `unknown`（跨层弱类型契约）——
    // 这里只做**同一性**比较，不需要它的成员类型。
    return getCoreAPI().getChatManager()?.getPermissionManager?.() ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * 模拟一次权限判定 POST /v1/permissions/rules/simulate（R0，2026-11-17）
 *
 * 只读：**不执行任何工具**，也不写审计/计数；判定复用 `handleAuto` / `handleDefault`
 * 的同一实现（见 `PermissionManager#simulatePermission`）。
 *
 * D5（2026-11-26）：响应带 `consistentWithExecution` —— 模拟与真实执行是否读**同一个**
 * 权限运行时。两者不同 ⇒ 各持一份规则快照，结论可能漂移（2026-11-26 真机 R3/R5/R6）。
 * `null` = 执行侧尚未装配，无法核对（不谎报一致）。
 *
 * 注：该路径在 `adminWriteRoutes` 的 `/v1/permissions` 前缀下 ⇒ POST 需管理面校验
 * （本机无 Bearer 时既有语义直接放行，桌面端行为不变）。
 */
export async function handleSimulatePermissionRule(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const parsedRaw: unknown = JSON.parse(body);
    if (
      parsedRaw === null ||
      typeof parsedRaw !== 'object' ||
      Array.isArray(parsedRaw)
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '请求体必须是 JSON 对象' } }));
      return;
    }
    const parsed = parseSimulateBody(parsedRaw as Record<string, unknown>);
    if (!parsed.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: parsed.message } }));
      return;
    }

    const manager = PermissionManager.getInstance();
    const result = await manager.simulatePermission(parsed.value);
    const runtimeManager = readRuntimePermissionManager();
    const consistentWithExecution =
      runtimeManager === undefined ? null : runtimeManager === manager;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        toolName: parsed.value.toolName,
        mode: result.mode,
        decision: result.decision,
        reason: result.reason,
        matchedRules: result.matchedRules.map(serializeRule),
        // R1.5：B 体系命令黑白名单的结论（区分"A 体系规则拦"还是"命令级策略拦"）
        customRuleVerdict: result.customRuleVerdict,
        evaluated: result.evaluated,
        consistentWithExecution,
        ...(consistentWithExecution === false
          ? {
              consistencyNote:
                '模拟与真实执行读的不是同一个权限运行时（规则快照可能不一致），结论仅供参考',
            }
          : consistentWithExecution === null
            ? {
                consistencyNote:
                  '执行侧权限运行时尚未装配（首条对话前），无法核对与真实执行的一致性',
              }
            : {}),
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}
