// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具执行**权限闸门**（2026-11-17，T3 复杂度清理 stage 3）。
 *
 * 从 `ToolExecutionService._executeInternal` **原样搬出**「权限检查」整段：
 *  ① 权限管理器注入断言（生产 fail-fast / 测试 fail-open）；
 *  ② `authorizeToolCall` 唯一判定入口（含身份位 / 审批模式 / 工作区边界 / 沙箱信号 / 自主度）；
 *  ③ 不允许时的三条出口：ask 已批准（放行继续）、ask 未批准（等审批 / 审批通道不可用）、DENY；
 *  ④ 允许时回传「会话权限档自动放行」来源，供调用方稳态日志标注。
 *
 * 为什么独立成模块：`_executeInternal` 圈复杂度 131，本段约占其一半；抽成注入依赖的
 * 纯逻辑后可直接单测（见 `app/tests/chat/permissionGate.test.ts`）。
 *
 * 契约：`result !== null` ⇒ 调用方**立即返回**该结果（不执行工具）；
 * `result === null` ⇒ 放行，继续后续边界/执行流程。
 */

import { getLogger } from '@openliri/infra/monitoring';
import {
  assertPermissionManagerInjected,
  authorizeToolCall,
  getEffectivePermissionRole,
  getEffectivePermissionRoles,
  resolveApprovalFingerprint,
  type PermissionMode,
  type ToolPermissionPort,
} from '@openliri/infra/permission';
import { getRequestPrincipal } from '@openliri/kernel/identity/requestScope.js';
import {
  resolveFileIoToolModeHint,
  resolveSandboxExecutionSignal,
} from '@modules/sandbox';
import { eventNotificationService } from './EventNotificationService.js';
import type { Tool } from '../../tools/types/Tool';
import type { ToolResult } from '@modules/session/types/tool.js';

const logger = getLogger('chat:toolExecution');

/** 权限闸门所需的宿主能力（与 `ToolExecutionDeps` 对应字段同口径） */
export interface ToolPermissionGateDeps {
  getPermissionManager(): ToolPermissionPort | null | undefined;
  resolveRegisteredTool(name: string): Tool | undefined;
  getSessionApprovalMode?: (sessionId?: string) => 'ask' | 'auto-local';
  getSessionPermissionMode?: (sessionId?: string) => PermissionMode | undefined;
  getSessionWorkspacePath(sessionId?: string): string | null | undefined;
  getSessionWorkspaceRoots?: (sessionId?: string) => string[];
  getSessionAutonomy?: (sessionId?: string) => 'interactive' | 'demand';
  isCommandApproved(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string,
    approvalFingerprint?: string
  ): Promise<boolean>;
  workspaceRootsHint(
    sessionId: string | undefined,
    args: Record<string, unknown>
  ): string;
  resolveNonIdempotentRetryReason(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string
  ): string | undefined;
  resolveIntentText(sessionId?: string): string | undefined;
  /** 瞬态「等待审批」状态值（唯一事实源仍在 `ToolExecutionService` 常量） */
  awaitingApprovalStatus: string;
}

export interface ToolPermissionGateParams {
  toolCall: { id: string; name: string; sessionId?: string };
  args: Record<string, unknown>;
  deps: ToolPermissionGateDeps;
}

export interface ToolPermissionGateOutcome {
  /** 非 `null` ⇒ 调用方立即返回（拒绝 / 等审批 / 审批通道不可用） */
  result: ToolResult | null;
  /** 允许且由会话权限档自动放行时的来源标注 */
  autoInfo?: { autoApproved: true; approvalSource?: string };
}

export async function applyToolPermissionGate(
  params: ToolPermissionGateParams
): Promise<ToolPermissionGateOutcome> {
  const { toolCall, args, deps } = params;

  // ── 权限检查 ──
  // D2（2026-10-11 用户裁定「启动 fail-fast 断言」）：权限管理器未注入是**装配异常** ⇒
  // 生产/开发路径 **fail-fast**（抛错拒绝执行，不再 fail-open 静默跳过）；测试环境保留 fail-open。
  // 原（2026-10-08）仅补 warn、语义仍 fail-open（G9）。
  if (!deps.getPermissionManager()) {
    logger.warn(
      '权限管理器未注入 ⇒ 权限检查缺失；生产路径预期由 CoreAPIImpl 注入 createPermissionManager()' +
        '（测试环境按约定 fail-open，其余环境将 fail-fast 拒绝执行）',
      { toolName: toolCall.name, toolCallId: toolCall.id }
    );
    assertPermissionManagerInjected(
      deps.getPermissionManager(),
      'chat:toolExecution'
    );
  }

  // P3（2026-11-07，方案 §2.3-4）：会话权限档自动放行的来源（供调用方稳态日志标注）
  let autoInfo: { autoApproved: true; approvalSource?: string } | undefined;

  if (deps.getPermissionManager()) {
    // P1（2026-11-03）：权限判定的**唯一入口**（与 HTTP/CoreAPI 路径共用，见
    // `packages/infra/src/permission/authorizeToolCall.ts`）—— 此前这里内联构造
    // 上下文并自行解构 `checkPermissionForTool` 返回值，两套入口各写一份口径。
    const pm = deps.getPermissionManager() as ToolPermissionPort;
    // R07-3（2026-10-07）：非幂等工具的「重试」⇒ 执行前**主动分流**为审批
    // （原实现仅把 `[重试注意]` 写进 tool 结果回传模型，属**被动**提示）。
    // 多租户 P0 阶段 2：把**身份位**带进权限判定 —— 已认证请求各带各的角色；
    // 本地身份按 admin（桌面即 owner，2026-11-11 裁定）参与 RBAC 角色绑定。
    const requestRole = getEffectivePermissionRole();
    // P2-6（2026-11-11）：RBAC 按**角色并集**判定 —— 多角色用户的第二角色起的绑定也要生效
    const requestRoles = getEffectivePermissionRoles();
    // 2026-11-11：userId 一并传入 —— 细粒度 RBAC 的“用户级绑定”按 userId 命中；
    // 此前只传 userRole，用户级规则永远不会生效（本地身份 userId = local）。
    const requestUserId = getRequestPrincipal().userId;
    // PR-0（2026-10-23）：把**工具对象**带进权限判定 —— 风险类别按工具声明派生
    // （`riskClass`/`riskClassFor`/`TOOL_EFFECTS`/`sandboxLevel`），不再按工具名猜。
    // 取不到（未注册/懒加载未解包）⇒ 传 undefined，权限层回退旧启发式（行为零变更）。
    const permissionTool = deps.resolveRegisteredTool(toolCall.name);
    const permissionResult = await authorizeToolCall(pm, {
      toolName: toolCall.name,
      args,
      context: {
        sessionId: toolCall.sessionId,
        // 2026-11-12：审批卡据此记下调用 id（用户拒绝时写终态结果并续跑）
        toolCallId: toolCall.id,
        userId: requestUserId,
        ...(requestRole ? { userRole: requestRole } : {}),
        ...(requestRoles.length > 0 ? { userRoles: requestRoles } : {}),
        ...(permissionTool ? { tool: permissionTool } : {}),
        // PR-3：会话级审批模式 + 工作区边界（自动执行只放行工作区内的本地写）
        approvalMode:
          deps.getSessionApprovalMode?.(toolCall.sessionId) ?? 'ask',
        // P1（2026-11-04）：会话级权限模式（缺省 ⇒ 权限层的进程默认档）
        permissionMode: deps.getSessionPermissionMode?.(toolCall.sessionId),
        workspacePath:
          deps.getSessionWorkspacePath(toolCall.sessionId) ?? undefined,
        // P1（2026-11-04，方案 §3.6）：工作区**根列表**同源注入 —— 权限层 `auto-local`
        // 的边界判定据此"任一根之内即放行"（此前只认单根 `workspacePath`，
        // 与执行前严格边界用多根的口径不一致）。取不到 ⇒ 权限层回落单根。
        workspaceRoots:
          deps.getSessionWorkspaceRoots?.(toolCall.sessionId) ?? undefined,
        // PR-3a（2026-10-23）：沙箱信号 —— 审批卡留证 + PR-3b 豁免判定。
        // 方案 A（同批）：文件类工具（`file-io`）若真在容器/远端工作区执行，则由
        // `modeHint` 如实上报（Landlock 只包命令子进程，不代表文件 IO 被隔离）；
        // 无映射/本地工作区 ⇒ 不给提示（保持 `none`，fail-closed）。
        sandbox: resolveSandboxExecutionSignal({
          modeHint: resolveFileIoToolModeHint(permissionTool?.sandboxLevel),
        }),
        // P0（2026-11-17）：许愿式（demand）的"中途最多问一次" —— 权限层据此把
        // 非危险 ask 降级为自动放行（工作区外写仍人工）。
        autonomy: deps.getSessionAutonomy?.(toolCall.sessionId),
        forceAskReason: deps.resolveNonIdempotentRetryReason(
          toolCall.name,
          args,
          toolCall.sessionId
        ),
        // 语义护栏「便宜版」：把本轮意图文本带进权限判定（缺失 ⇒ 护栏不判）
        metadata: {
          goalText: deps.resolveIntentText(toolCall.sessionId),
        },
      },
    });

    if (!permissionResult.allowed) {
      if (permissionResult.kind === 'ask') {
        // 形态④（2026-11-06 裁定）：把本轮可访问根一并回给模型，避免它拿着
        // 真实项目路径反复重试（长程/自主任务的 cwd 是隔离工作区）。
        const scopeHint = deps.workspaceRootsHint(toolCall.sessionId, args);
        const approvedHit = await deps.isCommandApproved(
          toolCall.name,
          args,
          toolCall.sessionId,
          resolveApprovalFingerprint(permissionTool ?? toolCall.name, args)
        );
        if (!approvedHit) {
          if (permissionResult.submittedToInbox === true) {
            // 企业审批镜像（**默认关**）：把同一条审批投给企业审批流，
            // 由企业侧批准/拒绝后再回灌 Inbox（单一赢家由 CAS 保证）。
            // 动态 import：该路径**只在实际出现 ASK 时**走到，且镜像模块会连带加载
            // 企业审批管理器 —— 静态引入会让它进启动面（棘轮 +1.3KB）。
            void import('@openliri/service/runtime/execApprovalBridge')
              .then(({ mirrorAskToEnterpriseApproval }) => {
                mirrorAskToEnterpriseApproval({
                  inboxItemId: permissionResult.inboxItemId,
                  toolName: toolCall.name,
                  toolInput: args,
                  requester: getRequestPrincipal().userId,
                  description: permissionResult.reason ?? '工具执行需要审批',
                  sessionId: toolCall.sessionId,
                });
              })
              .catch((error: unknown) => {
                // @ignore-catch — 镜像失败不影响原审批流程（Inbox 卡片仍然有效）
                logger.debug('企业审批镜像加载失败（忽略）', {
                  toolName: toolCall.name,
                  error: String(error),
                });
              });
            const approvalResult = {
              status: deps.awaitingApprovalStatus,
              message: `工具 '${toolCall.name}' 需要审批，已提交审批卡片等待用户批准。用户批准后可继续执行，请勿编造替代方案。${scopeHint}`,
              pendingApproval: true,
              // U-06-5：Inbox 项 id —— 前端工具卡片就地审批（无则退回卡片/收件箱入口）
              inboxId: permissionResult.inboxItemId,
            } as const;
            eventNotificationService.emitCustomEvent('tool:completed', {
              toolName: toolCall.name,
              sessionId: toolCall.sessionId,
              toolCallId: toolCall.id,
              resultData: approvalResult,
            });
            return {
              result: {
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                result: approvalResult,
                error: undefined,
              },
            };
          }
          return {
            result: {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              result: null,
              // P0-2（2026-10-27）：审批通道不可用必须**可见**。
              // 此前只回「需要用户确认」，用户以为在等审批，而审批卡从未生成（实测会话
              // `session_mvoqs1ho875ea6b95e` 连续 13 次因此被判失败且无人可批）。
              error:
                `需要用户确认，但审批通道不可用（${permissionResult.reason || 'Inbox 提交失败'}）：` +
                '本次调用未排队；请先修复审批通道（如数据库迁移/权限目录）后重新发起。' +
                scopeHint,
              // LRO-09：审批未能提交（Inbox 不可用等）⇒ 环境层阻塞，非模型输出问题
              failureKind: 'permission_denied',
              metadata: { approvalChannelDown: true },
            },
          };
        }
      } else {
        return {
          result: {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: null,
            error: `Permission denied: ${permissionResult.reason || 'Tool execution not allowed'}`,
            // LRO-09：权限决策为 DENY（结构化依据）⇒ 重试不会改变结果
            failureKind: 'permission_denied',
            // LRO-07（2026-10-26）：把「哪条规则、来源、怎么解除」**结构化**带进工具结果
            //（此前只有一句 reason，`decision.context` 在归一化时被截断 ⇒ 上游只能看到文案）
            ...(permissionResult.denyInfo
              ? { metadata: { permissionDeny: permissionResult.denyInfo } }
              : {}),
          },
        };
      }
    }

    // P3（2026-11-07，方案 §2.3-4）：允许分支已收敛 ⇒ 记录「自动放行」来源，
    // 供下方稳态日志标注（此处 `permissionResult` 才被 TS 收敛为 allow 变体）
    autoInfo =
      permissionResult.allowed && permissionResult.autoApproved
        ? {
            autoApproved: true,
            ...(permissionResult.approvalSource
              ? { approvalSource: permissionResult.approvalSource }
              : {}),
          }
        : undefined;
  }

  return { result: null, autoInfo };
}
