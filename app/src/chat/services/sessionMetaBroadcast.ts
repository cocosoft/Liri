// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话元数据变更的**前端通知**（P1-2，2026-11-06）
 *
 * 背景：会话状态（`requires_action` ⇄ `active`）由后端在"等待审批/续跑"时改写，
 * 但会话列表的状态徽标只在 `session:meta_updated` 到达时才重取 ⇒ 不广播就会一直停在
 * 旧徽标（真机：批准后续跑已完成，列表仍显示"待审批"）。
 *
 * 为什么走 `handler-utils.broadcastEvent`：它是 SSE 广播的既有唯一入口（HTTP 层已在用），
 * 且本模块（app 层）向下依赖 service 层合法。动态导入避免 chat ⇄ http 的静态环。
 */
export async function notifySessionMetaUpdated(
  sessionId: string
): Promise<void> {
  if (!sessionId) return;
  try {
    const { broadcastEvent } =
      await import('@modules/infrastructure/http/handlers/handler-utils');
    broadcastEvent('session:meta_updated', { id: sessionId });
  } catch {
    // @ignore-catch — 广播失败不影响主流程（前端下次列表刷新仍能拿到真实值）
  }
}
