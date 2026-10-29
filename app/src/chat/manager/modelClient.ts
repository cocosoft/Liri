// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * modelClient — 「按模型名选择 LLM 客户端」的外移（issue #17 · D3，2026-10-29）
 *
 * 迁出来源：`ChatManager.getClientForModel` 的方法体（原 3313–3358，约 46 行）。
 *
 * 语义（与迁移前逐字一致）：
 * - 客户端未初始化 ⇒ 抛 `AppError(EXECUTION/HIGH, '1000')`；
 * - 未指定模型 / 模型属于当前供应商 ⇒ 复用当前客户端；
 * - 模型属于**其它**供应商且该供应商已注册 ⇒ 新建 `ToolAwareClient`；
 * - BUG-08（2026-10-22）：模型有归属供应商但供应商**未注册** ⇒ 抛配置错误，
 *   **绝不静默回落**（否则会把模型名发给默认供应商，得到上游 400 被折成"正常回复"）。
 */

import { providerRegistry, ToolAwareClient } from '@modules/ai';
import type { IToolExecutor, ToolRegistry } from '@modules/ai';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { resolveModelRoutingFailure } from '../../ai/providers/modelRoutingGuard';

export interface ModelClientPorts {
  /** 当前绑定的客户端（未初始化 ⇒ `undefined`） */
  llmClient: ToolAwareClient | undefined;
  /**
   * 宿主 `toolRegistry`（`tools` 域类型）。`ToolAwareClient` 需要 `ai` 域类型，
   * 两域结构等价但无公共别名 ⇒ 在**本模块内单点转换**（与迁移前调用点同口径）。
   */
  toolRegistry: unknown;
  toolExecutor: IToolExecutor | null;
}

/**
 * 根据模型名获取对应的 LLM 客户端；模型属于其他 Provider 时自动创建 `ToolAwareClient`。
 */
export function getClientForModel(
  ports: ModelClientPorts,
  model?: string
): ToolAwareClient {
  if (!ports.llmClient) {
    throw new AppError(
      'LLM client not initialized',
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  if (!model) return ports.llmClient;

  const currentProviderId = ports.llmClient.getProviderId();
  const resolvedProvider = providerRegistry.getByModel(model);

  if (resolvedProvider && resolvedProvider.id !== currentProviderId) {
    return new ToolAwareClient(
      resolvedProvider,
      ports.toolRegistry as unknown as ToolRegistry,
      ports.toolExecutor
    );
  }

  // BUG-08（2026-10-22）：模型有归属供应商、但该供应商**未注册**（凭据缺失被同步跳过 /
  // 供应商停用）时，绝不静默回落到当前客户端 —— 否则会把该模型名发给默认供应商，
  // 得到上游 400 并被折成"正常回复"（HTTP 200 假成功）。
  const providerType = providerRegistry.resolveModelToProviderId(model);
  const failure = resolveModelRoutingFailure({
    model,
    providerType,
    providerLabel: providerRegistry.getModelProviderLabel(model),
    providerRegistered:
      !!resolvedProvider ||
      (!!providerType && !!providerRegistry.getByType(providerType)),
  });
  if (failure) {
    throw new AppError(
      failure.message,
      ErrorCategory.CONFIGURATION,
      ErrorSeverity.MEDIUM,
      failure.code
    );
  }

  return ports.llmClient;
}
