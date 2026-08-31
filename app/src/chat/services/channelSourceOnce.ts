// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * M4-T4.1 — 会话来源 set_once 判定（纯函数，独立模块便于单测）
 *
 * 规则：仅当本次请求元数据带非空 channel、且会话尚无来源标记时，
 * 返回待写入的 channel；否则返回 undefined（不覆盖既有来源）。
 *
 * 供 SessionLifecycleManager._applyChannelSourceOnce（通道会话首次请求时补写
 * metadata.channel）与单测使用。
 */
export function resolveChannelSourceOnce(
  metadata: Record<string, unknown> | undefined,
  existing: unknown
): string | undefined {
  const channel = metadata?.channel;
  if (typeof channel !== 'string' || !channel) return undefined;
  if (typeof existing === 'string' && existing) return undefined; // 已有来源，不覆盖
  return channel;
}
