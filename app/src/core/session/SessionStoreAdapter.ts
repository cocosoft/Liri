/**
 * SessionStoreAdapter — 将 session/SessionStore 适配为 SessionSupervisor.SessionStore
 *
 * SessionSupervisor 需要精简的 SessionStore 接口（listSessions/markIdle/deleteSession），
 * 而 session/SessionStore 接口更丰富。本适配器桥接二者。
 *
 * G1 收口（台账 D-59）：输入侧不再引用 session（service 层）的 `SessionStore` 类，
 * 改由 core 自持结构端口 `SessionStorePort`（上层实现结构满足），消除 core → service 倒挂。
 */

import type {
  SessionStore as SessionSupervisorStore,
  SessionSummary,
} from './SessionSupervisor';

/** 适配所需的最小会话视图（core 侧自持，避免依赖 session 层模型） */
export interface SupervisedSessionView {
  id: string;
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
  state?: { currentState: string };
}

/** 被适配的会话存储端口（session/SessionStore 结构满足） */
export interface SessionStorePort {
  listSessions(): Promise<string[]>;
  loadSession(sessionId: string): Promise<SupervisedSessionView | null>;
  saveSession(session: SupervisedSessionView): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}

export function createSupervisorStore(
  sessionStore: SessionStorePort
): SessionSupervisorStore {
  return {
    async listSessions(): Promise<SessionSummary[]> {
      const ids = await sessionStore.listSessions();
      const summaries: SessionSummary[] = [];
      for (const id of ids) {
        const s = await sessionStore.loadSession(id);
        if (s) {
          summaries.push({
            id: s.id,
            lastActivityAt:
              s.updatedAt instanceof Date
                ? s.updatedAt.getTime()
                : new Date(s.updatedAt).getTime(),
            status: s.state?.currentState ?? 'active',
            createdAt:
              s.createdAt instanceof Date
                ? s.createdAt.getTime()
                : new Date(s.createdAt).getTime(),
          });
        }
      }
      return summaries;
    },

    async markIdle(sessionId: string): Promise<void> {
      const s = await sessionStore.loadSession(sessionId);
      if (s) {
        if (s.state) {
          s.state.currentState = 'idle';
        }
        await sessionStore.saveSession(s);
      }
    },

    async deleteSession(sessionId: string): Promise<void> {
      await sessionStore.deleteSession(sessionId);
    },
  };
}
