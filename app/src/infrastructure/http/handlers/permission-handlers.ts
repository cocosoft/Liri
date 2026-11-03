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
} from '@openliri/infra/permission/types/PermissionRule';
import {
  shadowedRuleDetector,
  permissionMetrics,
  PermissionManager,
} from '@openliri/infra/permission';

const VALID_BEHAVIORS: string[] = ['allow', 'deny', 'ask'];

/** 序列化规则（Date → ISO 字符串，供 JSON 传输） */
function serializeRule(rule: PermissionRule): Record<string, unknown> {
  return {
    id: rule.id,
    behavior: rule.behavior,
    toolName: rule.toolName,
    contentPattern: rule.contentPattern,
    // PR-2（2026-10-23）：「始终允许」规则（工具 + 参数指纹）—— 前端据此展示/撤销，
    // 只暴露摘要（32 hex），原始参数从未落库
    inputFingerprint: rule.inputFingerprint,
    source: rule.source,
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

/**
 * 添加工具权限规则 POST /v1/permissions/rules
 * body: { behavior: 'allow' | 'deny' | 'ask', toolName: string, contentPattern?: string }
 */
export async function handleAddPermissionRule(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { behavior, toolName, contentPattern } = JSON.parse(body);

    if (
      typeof toolName !== 'string' ||
      !toolName ||
      typeof behavior !== 'string' ||
      !VALID_BEHAVIORS.includes(behavior)
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'behavior 必须为 allow/deny/ask，toolName 必填字符串',
          },
        })
      );
      return;
    }

    const manager = PermissionManager.getInstance();
    manager.addRule(
      behavior as PermissionBehavior,
      toolName,
      typeof contentPattern === 'string' && contentPattern
        ? contentPattern
        : undefined
    );
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: '权限规则已添加' }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 删除工具权限规则 DELETE /v1/permissions/rules/{ruleId}
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
    const manager = PermissionManager.getInstance();
    manager.removeRule(ruleId);
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
