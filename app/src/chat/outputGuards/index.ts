// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 输出侧护栏组合根（13-P2-1）
 *
 * 统一契约与注册表在 **core**（`core/outputGuard`）；本目录承载**具体护栏实现**
 * （复用 `security/*` = infra 层原语 ⇒ 落 app 层合法）。
 *
 * `registerDefaultOutputGuards()` 由 chat 组合根（`ChatManager` 构造）调用，幂等：
 * - `OUTPUT_GUARD=false`（默认）⇒ **不注册**任何护栏 ⇒ 输出路径行为与原状完全一致（零回归）；
 * - `OUTPUT_GUARD=true` ⇒ 注册 敏感内容（打码/阻断）+ 注入回显（提示）两条护栏。
 */

import { feature, getOutputGuardRegistry } from '@modules/core';
import type { OutputGuardRegistry } from '@modules/core';

import { createInjectionEchoGuard } from './injectionEchoGuard.js';
import { createSensitiveContentGuard } from './sensitiveContentGuard.js';

export {
  createSensitiveContentGuard,
  SENSITIVE_CONTENT_GUARD,
} from './sensitiveContentGuard.js';
export {
  createInjectionEchoGuard,
  INJECTION_ECHO_GUARD,
} from './injectionEchoGuard.js';
// PC-1（2026-10-07）：护栏结果经全局 SSE 下发前端（消息级"已打码/已阻断"标注）
export {
  OUTPUT_GUARD_SSE_EVENT,
  buildOutputGuardNotice,
  buildOutputGuardPayload,
  emitOutputGuardNotice,
  notifyOutputGuardResult,
} from './liveEvents.js';
export type {
  OutputGuardNotice,
  OutputGuardNoticeAction,
} from './liveEvents.js';

/** 注册默认输出护栏（幂等；未开启 `OUTPUT_GUARD` 时为空注册） */
export function registerDefaultOutputGuards(
  registry: OutputGuardRegistry = getOutputGuardRegistry()
): void {
  if (!feature('OUTPUT_GUARD')) return;
  registry.register(createSensitiveContentGuard());
  registry.register(createInjectionEchoGuard());
}
