// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * approvalAuditCsv — 「自动放行审计」明细的 CSV 生成（PR-3c 尾声，2026-10-23）
 *
 * 数据源：`GET /v1/security/audit-logs?decision=auto_allowed`（`SecurityAuditEvent[]`，
 * 其中 `approval:*` 事件的 `command` = 工具名、`truncatedResult` = 判定依据明细）。
 *
 * 纯函数、零依赖：组件只负责取数与下载，转义规则单点在此（CS01 归一化）。
 */

/** 组件实际用到的字段（只声明消费面，避免把后端全量类型搬进客户端） */
export interface ApprovalAuditEvent {
  timestamp?: string;
  /** 工具名（`auditAutoAllow` 写入时 command = toolName） */
  command?: string;
  /** 判定依据明细 */
  truncatedResult?: string;
  /** 命中来源（`approval:sandbox` / `approval:auto` / `approval:trust`） */
  matchedRules?: string[];
  riskLevel?: string;
  sessionContext?: { sessionId?: string };
}

/** 默认表头（组件可按当前语言覆盖） */
export const DEFAULT_AUDIT_CSV_HEADERS = [
  '时间',
  '来源',
  '工具',
  '风险',
  '会话',
  '明细',
] as const;

/**
 * 单元格转义：含分隔符 / 引号 / 换行时加双引号，内部双引号翻倍（RFC 4180）。
 */
export function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * 生成 CSV 文本。
 *
 * - 表头行 + 每事件一行；**行序 = 传入顺序**（调用方负责排序）；
 * - 时间原样输出 ISO 串（无歧义、可排序；不做本地化，避免导出结果随语言漂移）。
 */
export function buildApprovalAuditCsv(
  events: readonly ApprovalAuditEvent[],
  headers: readonly string[] = DEFAULT_AUDIT_CSV_HEADERS
): string {
  const rows: string[] = [headers.map(csvCell).join(',')];
  for (const event of events) {
    rows.push(
      [
        event.timestamp ?? '',
        (event.matchedRules ?? []).join('|'),
        event.command ?? '',
        event.riskLevel ?? '',
        event.sessionContext?.sessionId ?? '',
        event.truncatedResult ?? '',
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return rows.join('\r\n');
}
