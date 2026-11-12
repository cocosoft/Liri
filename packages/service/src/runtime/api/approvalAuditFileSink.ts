/**
 * 审批四段事件的**文件落盘出口**（G4 围栏 M0-④，2026-11-12）
 *
 * 背景：`emitApprovalAudit()` 只投注入式 sink（默认写会话事件流），跨进程不可见 ⇒
 * 围栏（只读文件）读不到审批链。本模块把四段事件按 **JSONL** 追加到
 * `<securityDir>/approval-audit.jsonl`，供围栏后续（I4）消费。
 *
 * 边界：
 * - **只在开关 `approvalFourStage.enabled === true` 时才会被调用**（判定在 `emitApprovalAudit` 内）
 *   ⇒ 开关关闭时**不建文件、零写入**；
 * - append-only + 逐行完整 JSON：崩溃最多丢最后一行，不损坏已有内容；
 * - 只搬运事件字段（不补造字段），`at` 为落盘时刻、`sessionId` 为审批链归属。
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { resolveSecurityDir } from '@openliri/infra/environment';
import type { ApprovalAuditEvent } from '@openliri/infra/permission';

/** 围栏读取的文件名（与设计文档 I4 一致） */
export const APPROVAL_AUDIT_FILE = 'approval-audit.jsonl';

/** 默认路径：`<securityDir>/approval-audit.jsonl` */
export function resolveApprovalAuditFilePath(
  securityDir: string = resolveSecurityDir()
): string {
  return join(securityDir, APPROVAL_AUDIT_FILE);
}

/**
 * 构造一行 JSONL（纯函数，单测直接断言）。
 * @param at 落盘时刻（单测注入）
 */
export function buildApprovalAuditLine(
  sessionId: string,
  event: ApprovalAuditEvent,
  at: Date = new Date()
): string {
  return `${JSON.stringify({ at: at.toISOString(), sessionId, ...event })}\n`;
}

/** 追加一行（目录不存在则创建；失败由调用方降级） */
export async function appendApprovalAuditLine(
  line: string,
  targetPath: string = resolveApprovalAuditFilePath()
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  await appendFile(targetPath, line, 'utf8');
}
