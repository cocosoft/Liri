// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 优雅关闭请求端口（2026-11-12）
 *
 * ## 背景
 * 优雅关闭此前**只有信号入口**（`main.ts` 的 `SIGINT` / `SIGTERM`：flush 事件缓冲 +
 * 为可中断会话写 `cleanShutdown` 标记）。Windows 上 `Stop-Process` / 任务管理器结束进程
 * **不投递信号** ⇒ 下次启动按「有活动且 idle > 30min」把会话标 `failed_stale`
 * （运维侧实证，见 `dev_docs/20261111/剩余问题修复方案-20261111.md` 运维提示）。
 *
 * ## 本模块边界
 * 这是 HTTP（infra 层）→ 宿主关闭链的**依赖倒置端口**：HTTP 层只发"请关闭"请求，
 * 真正的关闭序列由入口 `main.ts` 注册（那里持有 `activeHttpService` 与各子系统句柄）。
 * 这样 infra 不需要反向 import 入口模块（R03 / R06-008 分层约束）。
 *
 * 单例语义：后注册覆盖先注册（入口只注册一次；测试可覆盖为替身）。
 */

type ShutdownRequester = () => void;

let requester: ShutdownRequester | null = null;

/** 注册关闭请求处理器（由入口 `main.ts` 调用；传 `null` 可注销，供测试复原） */
export function registerShutdownRequester(fn: ShutdownRequester | null): void {
  requester = fn;
}

/** 是否已注册关闭链（未注册时不得对外假装"已受理"） */
export function hasShutdownRequester(): boolean {
  return requester !== null;
}

/**
 * 触发优雅关闭。
 * @returns `true` = 已交给宿主关闭链；`false` = 宿主未注册（fail-closed）
 */
export function requestGracefulShutdown(): boolean {
  const fn = requester;
  if (!fn) return false;
  fn();
  return true;
}
