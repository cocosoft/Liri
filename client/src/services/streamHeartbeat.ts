/**
 * 聊天流心跳（`lastBeatAt`）—— 后端 SSE 保活注释行的唯一登记处。
 *
 * 背景（2026-11-18，用户反馈「前端看不出在运行，以为挂了」）：
 * 后端每 15s 往聊天 SSE 写一行注释 `: heartbeat`
 * （`app/src/infrastructure/http/handlers/chat-handlers.ts` 的 keepaliveInterval），
 * 这是链路存活的直接凭证；但客户端解析器此前只认 `data:`，注释行被直接丢弃
 * ⇒ 界面拿不到任何「心跳刚来过」的证据，一个字不变的 UI 与真死掉的 UI 长得一样。
 *
 * 为什么是独立模块而不是 chat store 字段：
 * `services/chatService.ts` 是流解析的叶子，chat store 依赖它
 * （`chat-message-stream` → `chatService`），把心跳写进 store 会形成
 * store ⇄ service 循环导入。故此处用极小的订阅表承载，
 * `hooks/useRunClock.ts` 通过 `useSyncExternalStore` 订阅。
 *
 * 为什么按会话分键：多会话可并行流式（P2-2），全局单值会让**别的会话**的心跳
 * 替死掉的流作证 —— 那是伪造活性证据（CS04）。
 *
 * 状态语义（CS02）：只存**结构化时间戳**，是否停滞由时间差推导，不做文案判断。
 */

/** 后端心跳间隔（ms）：与 `chat-handlers.ts` 的 `setInterval(..., 15000)` 对齐 */
export const STREAM_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * 判「停滞」的阈值（ms）。取 6 个心跳周期 = 90s：
 * - 后端单次 ReAct 迭代内可能出现**事件循环阻塞**（实测 57.4s，见
 *   `utils/readWithIdleTimeout.ts` D-231 注释），阻塞期间心跳同样发不出
 *   ⇒ 阈值必须高于该实测值，否则会把「正常长思考」误报成断线；
 * - 仍显著低于前端 idle 超时 300s ⇒ 能在真正超时报错之前给出预警。
 */
export const STREAM_BEAT_STALL_MS = STREAM_HEARTBEAT_INTERVAL_MS * 6;

/** 会话 key：与 chat store 的 `sessionId || "default"` 约定一致 */
function beatKey(sessionId?: string): string {
  return sessionId || "default";
}

const lastBeatBySession = new Map<string, number>();
const listeners = new Set<() => void>();

/** 登记一次心跳（默认取当前时刻；测试可注入固定时间） */
export function noteStreamHeartbeat(
  sessionId?: string,
  at: number = Date.now(),
): void {
  lastBeatBySession.set(beatKey(sessionId), at);
  listeners.forEach((l) => l());
}

/** 新一次流式请求开始：清空该会话上一次的心跳证据（不能把旧连接的年龄当本次运行） */
export function resetStreamHeartbeat(sessionId?: string): void {
  if (!lastBeatBySession.delete(beatKey(sessionId))) return;
  listeners.forEach((l) => l());
}

export function getStreamHeartbeatAt(sessionId?: string): number | null {
  return lastBeatBySession.get(beatKey(sessionId)) ?? null;
}

export function subscribeStreamHeartbeat(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 该 SSE 行是否为后端心跳注释（`: heartbeat` / `:heartbeat`） */
export function isSseHeartbeatComment(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith(":")) return false;
  return trimmed.slice(1).trim() === "heartbeat";
}
