/**
 * streamPause — 断连挂起-恢复的等待注册表（阶段 2）
 *
 * 断连挂起机制核心：`streamMessageWithReconnect` 重试耗尽后不结束流，
 * 而是挂起等待——yield `paused` chunk 后 `await registerResumeWaiter(sessionId)`。
 *
 * - chat store 的 `resumeStream(sid)` → `resolveResumeWaiter` 让挂起的生成器继续
 *   （自动：connectionMonitor onBackendUp；手动：用户点"立即恢复"）
 * - chat store 的 `abortPausedStream(sid)` → `rejectResumeWaiter` 以中止方式结束
 *   （用户点"放弃本次回复"）
 *
 * 独立模块存放等待者 Map，避免 chatService（服务层）与 chat store（状态层）
 * 之间的循环依赖。
 */
import { createLogger } from "../utils/logger";

const logger = createLogger("services:stream-pause");

type ResumeWaiter = {
  resolve: () => void;
  reject: (err: Error) => void;
};

/** sessionId → 挂起中的等待者（同一会话同时只有一个挂起流） */
const waiters = new Map<string, ResumeWaiter>();

/**
 * 注册挂起等待（由 streamMessageWithReconnect 内部 await）。
 * 返回的 Promise 在 `resolveResumeWaiter`（恢复）或 `rejectResumeWaiter`（放弃）时结算。
 */
export function registerResumeWaiter(sessionId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // 异常兜底：同名会话已存在挂起等待者时先拒绝旧的，保证同一会话只有一个等待者
    const prev = waiters.get(sessionId);
    if (prev) {
      logger.warn("registerResumeWaiter: 同名会话已有挂起等待者，拒绝旧的", {
        sessionId,
      });
      prev.reject(new Error("session paused twice"));
    }
    waiters.set(sessionId, { resolve, reject });
  });
}

/** 恢复挂起（返回是否成功找到并结算等待者） */
export function resolveResumeWaiter(sessionId: string): boolean {
  const w = waiters.get(sessionId);
  if (!w) return false;
  waiters.delete(sessionId);
  w.resolve();
  return true;
}

/** 放弃挂起（返回是否成功找到并结算等待者） */
export function rejectResumeWaiter(sessionId: string, err: Error): boolean {
  const w = waiters.get(sessionId);
  if (!w) return false;
  waiters.delete(sessionId);
  w.reject(err);
  return true;
}

/** 是否存在挂起中的等待者（供恢复/放弃前判空） */
export function hasResumeWaiter(sessionId: string): boolean {
  return waiters.has(sessionId);
}
