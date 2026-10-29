// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * streamAbort — 会话流中止（issue #19 · Cut H，2026-10-29）
 *
 * 迁出来源：`ChatManager.abortSessionStream`（契约方法）的方法体（原 23 行）。
 * 宿主保留同名契约方法，只把"中止 + 幂等清理"的判定逻辑外移。
 *
 * 行为不变（逐字保留的三条纪律）：
 * 1. 先顺带中止该会话的活跃计划循环（S4/BUG-7）；
 * 2. 中止 reason 用**工厂**（带真实栈，声明为"系统侧中止"而非用户放弃）；
 * 3. 中止后**同实例**才删除条目（防止误删新一代流的 controller）。
 */

import { getLogger } from '@modules/monitoring';
import { createSystemAbortReason } from '@modules/query';
import { abortSessionPlans } from '../planAbortRegistry.js';

const logger = getLogger('chat:manager');

export interface StreamAbortHost {
  /** 该会话当前的中止控制器（无 ⇒ undefined） */
  getAbortController: (sessionId: string) => AbortController | undefined;
  /** 仅当条目仍是同一实例时删除（幂等兜底） */
  deleteAbortControllerIfSame: (
    sessionId: string,
    controller: AbortController
  ) => void;
}

/**
 * S1：中止指定会话的流式请求
 * 用于 req.on('close') → 通知后端停止工具执行
 */
export function abortSessionStream(
  host: StreamAbortHost,
  sessionId: string
): void {
  // S4/BUG-7 修复（2026-08-23）：停止会话流时顺带中止该会话的活跃计划循环
  // （方案 A：前端现有停止路径自动生效，无需透传 planId）
  abortSessionPlans(sessionId);
  const controller = host.getAbortController(sessionId);
  if (controller) {
    logger.info('req.on(close) 触发 — 中止会话流', { sessionId });
    // 二期 O2-1（2026-09-24）：本路径由 **HTTP 连接关闭（页面刷新/断线/请求中止）** 触发，
    // 属**系统侧**中止 —— 显式带 reason 声明来源，避免被记成"用户主动放弃"
    //（并据此把 Goal 落成 `system_aborted` 而非 `user_aborted`）。
    // ② 加固（2026-09-25，`.trae/specs/system-abort-reason-hardening.md`）：用**工厂**
    // 传 Error 形态 reason（带真实栈）—— 该 reason 若在下游外泄，栈可定位遗漏的 catch；
    // 每次新实例（禁止共享单例，否则栈全指向模块加载点）。
    controller.abort(createSystemAbortReason());
    // P2 修复（AB-2）：中止后立即清理条目，防止 isSessionStreaming() 恒 true
    // （幽灵块永久误报）。正常路径由 `_finalizeStreamMessage` 删除，此处兜底幂等；
    // 若内层生成器被遗弃、`_finalizeStreamMessage` 永不执行，旧条目也会在此清理。
    host.deleteAbortControllerIfSame(sessionId, controller);
  }
}
