/**
 * route-dispatch-types.ts — 领域路由子派发的统一入参
 *
 * 为什么单列：`dispatchCostChannelRoutes` 已按领域拆成多个子派发模块
 * （复杂度 99 的重尾离群，2026-10-20）。若把入参类型挂在组合根或某个子模块里，
 * 会形成"子模块 ↔ 组合根"的循环依赖 ⇒ 类型位单独成文件（零运行时依赖）。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';

/** 领域路由派发的统一入参（method 已在组合根解析一次） */
export interface RouteDispatchArgs {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  /** `req.method || 'GET'`（组合根统一求值，避免各子派发重复推导） */
  method: string;
  url: string;
  handlerCtx: HandlerCtx;
  /** 事件广播（频道切换 / Cron 增删改 / 预算变更等需要通知前端） */
  broadcastEvent: (event: string, data: unknown) => void;
}
