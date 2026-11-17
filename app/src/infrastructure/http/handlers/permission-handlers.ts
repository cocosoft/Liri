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
import { sendError, readRequestBody } from './handler-utils';
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
  readCommandRulesConfig,
  SIMULATABLE_PERMISSION_MODES,
  isSimulatablePermissionMode,
  type CommandRulesSettings,
  type RuleWriteResult,
  type SimulatablePermissionMode,
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
    readOnly: isApprovalOriginatedRule(rule),
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
    res.end(
      JSON.stringify({
        rules: [...rules.map(serializeRule), ...settingsRules],
        summary,
        // R1.5：B 体系命令规则（只读；来源=commandRules）—— 不配置时为 null
        commandRules: buildCommandRulesView(readCommandRulesConfig()),
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

/** 写失败 → HTTP 状态码（R2：冲突/损坏 409；只读 403；不存在 404；参数 400） */
function sendRuleWriteFailure(
  res: http.ServerResponse,
  failure: Extract<RuleWriteResult, { ok: false }>
): void {
  const status =
    failure.code === 'not-found'
      ? 404
      : failure.code === 'readonly'
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
 * body: { behavior: 'allow' | 'deny' | 'ask', toolName: string, contentPattern?: string, force?: boolean }
 *
 * R2：冲突（同键不同行为）⇒ 409 + `conflicts`；`force=true` 表示「后写为准」，
 * 但**不能**覆盖审批生成的规则。规则文件损坏 ⇒ 409（不覆盖最后可用数据）。
 */
export async function handleAddPermissionRule(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const { behavior, toolName, contentPattern, force } = parsed;

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
      (contentPattern !== undefined && typeof contentPattern !== 'string')
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message:
              'behavior 必须为 allow/deny/ask，toolName 必填字符串；contentPattern 为字符串，force 为布尔',
          },
        })
      );
      return;
    }

    const result = addRuleChecked(
      PermissionManager.getInstance().getRuleManager(),
      {
        behavior: behavior as PermissionBehavior,
        toolName,
        ...(typeof contentPattern === 'string' && contentPattern
          ? { contentPattern }
          : {}),
        ...(force === true ? { force: true } : {}),
      }
    );
    if (!result.ok) {
      sendRuleWriteFailure(res, result);
      return;
    }
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        message: '权限规则已添加',
        rule: serializeRule(result.rule),
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
    const { behavior, contentPattern } = parsed;
    if (
      parsed['toolName'] !== undefined ||
      parsed['force'] !== undefined ||
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
              '只允许改 behavior / contentPattern（null 清除）；toolName 不可修改；force 仅用于新增',
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

    const result = updateRuleChecked(
      PermissionManager.getInstance().getRuleManager(),
      ruleId,
      {
        ...(typeof behavior === 'string'
          ? { behavior: behavior as PermissionBehavior }
          : {}),
        ...(contentPattern !== undefined
          ? { contentPattern: contentPattern as string | null }
          : {}),
      }
    );
    if (!result.ok) {
      sendRuleWriteFailure(res, result);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        message: '权限规则已更新',
        rule: serializeRule(result.rule),
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
    const health = PermissionManager.getInstance()
      .getRuleManager()
      .getRuleFileHealth();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ generatedAt: Date.now(), ...health }));
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
 * 模拟一次权限判定 POST /v1/permissions/rules/simulate（R0，2026-11-17）
 *
 * 只读：**不执行任何工具**，也不写审计/计数；判定复用 `handleAuto` / `handleDefault`
 * 的同一实现（见 `PermissionManager#simulatePermission`）。
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

    const result = await PermissionManager.getInstance().simulatePermission(
      parsed.value
    );
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
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}
