// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P4（2026-11-21）—— 原址**转发**。副作用声明的唯一事实源已下沉至 `packages/tool-base`。
 *
 * 保留本路径使 `tools/**` / `chat/**` / `workspace/**` 既有引用**零改动**。
 * 新代码请直接 `import { TOOL_EFFECTS, resolveToolEffect } from '@openliri/tool-base'`。
 */
export {
  TOOL_EFFECTS,
  TOOL_EFFECTS_COUNT,
  BLIND_RETRY_MAX_ATTEMPTS,
  resolveToolEffect,
  shouldBlindRetryTool,
  resolveToolRetryBudget,
  isBlockedForUntrustedOrigin,
  resolveToolRecoveryPolicy,
  canReplayAfterUnknown,
  isNonIdempotentRetry,
} from '@openliri/tool-base';
export type {
  ToolSideEffect,
  ToolEffectOverride,
  ToolEffect,
  ToolRetryBudget,
  ToolRecoveryPolicy,
  PriorToolCall,
} from '@openliri/tool-base';
