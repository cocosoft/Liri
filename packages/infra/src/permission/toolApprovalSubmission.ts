// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具审批卡的**唯一构造点**（P1，2026-11-04）。
 *
 * 背景：此前有两个调用点各自拼 Inbox 审批卡 —— 判定前（`PermissionChecker._submitToInbox`）
 * 与执行后（`app/src/chat/manager/toolApproval.ts#submitToolApproval`）。两条触发点都必须保留
 * （执行后路径还要带工具的 `approvalScope`/`approvalSnapshot`），但**字段集与选项集出现了漂移**：
 * 执行后路径的卡没有 `metadata.risk`、`EXTERNAL` 类工具仍给出永久放行选项、且没有 sandbox 留证。
 *
 * 本文件只做一件事：把「卡片长什么样」收敛成纯函数。调用方仍各自负责
 * `inboxManager.submit(...)` 与审计 ②（presented）段。
 *
 * 口径（两侧字段并集，缺省不臆造）：
 * - 选项：命令类多 `allowlist_tool`；`EXTERNAL` 只给 本次 / 本会话 / 拒绝（外部副作用不提供永久放行）；
 * - `risk` 由 `resolveRiskClass()` 统一派生（传工具对象走声明，只传名字退回旧启发式）；
 * - `inputPreview` 统一截断 300 字符。
 */

import type { SandboxExecutionSignal } from '@openliri/infra/utils/toolContract/Tool';
import { isShellToolName } from '@openliri/infra/utils/toolContract/toolRoles';

import {
  resolveApprovalFingerprint,
  previewApprovalFingerprint,
} from './approvalFingerprint.js';
import {
  hashCommandForExecution,
  hashApprovalFingerprint,
  type ApprovalScope,
  type ApprovalSnapshot,
} from './ApprovedCommandRegistry.js';
import { RiskClass, resolveRiskClass } from './types/RiskClass.js';
import { newApprovalId } from './approvalAudit.js';

/** 审批卡入参（两侧调用点的并集；全部可选字段缺省即不写入） */
export interface ToolApprovalCardInput {
  /**
   * 工具对象或工具名。
   *
   * 只要求 `name`：风险与指纹各自由工具**可选声明**（`riskClass` / `riskClassFor` /
   * `approvalFingerprint`）派生，缺声明时退回名字启发式与全参数指纹。
   * 这样 `PermissionChecker` 的最小 `Tool` 与契约 `Tool` 都能直接传入（不做类型强制转换）。
   */
  toolOrName: string | { name: string };
  /** 本次调用入参 */
  input: Record<string, unknown>;
  /** 会话 id（Inbox 必填） */
  sessionId: string;
  /** 触发原因（执行后路径通常带"需要审批"的理由） */
  approvalReason?: string;
  /** 工具调用 id（前端就地审批用） */
  toolCallId?: string;
  /** 所属长任务 id */
  taskId?: string;
  /** 卡片来源模块（缺省 `permission`） */
  sourceModule?: string;
  /** S1-1：工具声明的执行作用域（执行时须一致才命中放行缓存） */
  approvalScope?: ApprovalScope;
  /** S1-1：审批快照（原始 / 规范化 / 改写项） */
  approvalSnapshot?: ApprovalSnapshot;
  /** PR-3a：沙箱上下文（仅留证，不参与判定） */
  sandbox?: SandboxExecutionSignal;
}

/** 审批卡（Inbox `submit` 的 `title/message/options/metadata` + 链 id 与哈希） */
export interface ToolApprovalCard {
  approvalId: string;
  risk: RiskClass;
  commandHash: string;
  fingerprintHash: string;
  title: string;
  message: string;
  options: string[];
  metadata: Record<string, unknown>;
}

/** 预览长度上限（输入参数 / 命令的落卡截断，统一 300 字符） */
const INPUT_PREVIEW_MAX_CHARS = 300;

/**
 * 构造一张工具审批卡。
 *
 * **纯函数**（除 `newApprovalId()` 的序号自增外无副作用）：审计 ①「申请」段由调用方在
 * **确认要新建卡之后**落（同指纹复用既有卡时不重复开链），②「呈现」段由调用方在 submit 成功后落。
 */
export function buildToolApprovalCard(
  params: ToolApprovalCardInput
): ToolApprovalCard {
  const { toolOrName, input, sessionId } = params;
  const toolName =
    typeof toolOrName === 'string' ? toolOrName : toolOrName.name;

  const command = typeof input.command === 'string' ? input.command : '';
  const isCommandTool = isShellToolName(toolName);
  const risk = resolveRiskClass(toolOrName, input);

  const approvalFingerprint = resolveApprovalFingerprint(toolOrName, input);
  const commandHash = hashCommandForExecution(approvalFingerprint);
  const fingerprintHash = hashApprovalFingerprint(approvalFingerprint);

  // PR-2 四档：命令类多一个工具级永久放行；外部副作用不提供永久放行（安全单调）。
  const options = isCommandTool
    ? [
        'approve',
        'approve_session',
        'allowlist_command',
        'allowlist_tool',
        'deny',
      ]
    : risk === RiskClass.EXTERNAL
      ? ['approve', 'approve_session', 'deny']
      : ['approve', 'approve_session', 'allowlist_call', 'deny'];

  const approvalId = newApprovalId();

  const previewText = JSON.stringify(input).slice(0, INPUT_PREVIEW_MAX_CHARS);
  const message =
    (params.approvalReason ? `${params.approvalReason}\n` : '') +
    `工具 '${toolName}' 请求执行（风险等级: ${risk}）\n` +
    (command ? `命令: ${command}` : `参数: ${previewText}`);

  const metadata: Record<string, unknown> = {
    toolName,
    risk,
    sessionId,
    taskId: params.taskId,
    toolCallId: params.toolCallId,
    approvalId,
    commandHash,
    approvalFingerprintHash: fingerprintHash,
    approvalFingerprintPreview: previewApprovalFingerprint(approvalFingerprint),
    approvalScopeKind: 'once',
    command: command || undefined,
    approvalScope: params.approvalScope,
    approvalSnapshot: params.approvalSnapshot,
    sourceModule: params.sourceModule ?? 'permission',
    sandboxMode: params.sandbox?.mode,
    sandboxPermissionLevel: params.sandbox?.permissionLevel,
    inputPreview: previewText,
  };

  return {
    approvalId,
    risk,
    commandHash,
    fingerprintHash,
    title: `工具审批: ${toolName}`,
    message,
    options,
    metadata,
  };
}
