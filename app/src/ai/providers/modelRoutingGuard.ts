/**
 * 模型路由前置校验（BUG-08，2026-10-22 前端巡检衍生）
 *
 * **缺陷现场**：`ChatManager.getClientForModel()` 用 `providerRegistry.getByModel(model)`
 * 选客户端；若该模型**有归属供应商但供应商未注册**（典型：`api_key` 是 `__stored__` 占位、
 * 凭据文件缺条目 ⇒ 启动同步按 fail-fast 跳过注册；或供应商已停用），`getByModel()` 返回
 * `undefined` ⇒ 静默回落到当前客户端。于是「智谱模型」被发给默认供应商 DeepSeek：
 *
 * ```
 * provider 聊天失败 {"provider":"OpenAI","error":"OpenAI API error (400): The supported
 *   API model names are deepseek-flash, deepseek-v4-pro, but you passed glm-5.2"}
 * → HTTP 200，错误被折进 assistant content（finish_reason=stop）  ← 假成功
 * ```
 *
 * 本判据把这种情况变成**可读错误**（同 `AI_CRED_1001` 契约），并且**绝不回落**到默认供应商。
 *
 * 边界（刻意保守，避免改变既有可用行为）：
 * - 模型**没有**归属映射（`providerType` 空）⇒ 返回 `null`，保持原回退（用户可能用供应商原生模型名）；
 * - 供应商**已注册可用** ⇒ 返回 `null`，正常路由。
 */

export interface ModelRoutingFailure {
  /** 可读错误文案（含供应商显示名 + 修复路径） */
  message: string;
  /** 与凭据缺失共用的业务码，前端可据此区分 */
  code: string;
}

export function resolveModelRoutingFailure(input: {
  model: string;
  /** 模型所属供应商类型（`providerRegistry.resolveModelToProviderId`） */
  providerType?: string;
  /** 供应商显示名（`providers.name`，非硬编码；缺失时退回类型名） */
  providerLabel?: string;
  /** 该供应商是否已注册可用（`getByModel` 命中或 `getByType` 命中） */
  providerRegistered: boolean;
}): ModelRoutingFailure | null {
  if (!input.providerType) return null;
  if (input.providerRegistered) return null;

  const label = input.providerLabel?.trim() || input.providerType;
  return {
    code: 'AI_CRED_1001',
    message:
      `供应商「${label}」当前不可用（API Key 未配置或供应商已停用），模型「${input.model}」无法调用。` +
      '请到「模型管理 → 供应商」检查该供应商配置后重试。',
  };
}
