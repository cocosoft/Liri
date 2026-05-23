/**
 * SessionStoreAdapter — 将 session/SessionStore 适配为 SessionSupervisor.SessionStore
 *
 * SessionSupervisor 需要精简的 SessionStore 接口（listSessions/markIdle/deleteSession），
 * 而 session/SessionStore 接口更丰富。本适配器桥接二者。
 */

import type { SessionStore as SessionSupervisorStore, SessionSummary } from './SessionSupervisor';
import type { SessionStore } from '@modules/session/SessionStore';

export function createSupervisorStore(sessionStore: SessionStore): SessionSupervisorStore {
  return {
    async listSessions(): Promise<SessionSummary[]> {
      const ids = await sessionStore.listSessions();
      const summaries: SessionSummary[] = [];
      for (const id of ids) {
        const s = await sessionStore.loadSession(id);
        if (s) {
          summaries.push({
            id: s.id,
            lastActivityAt: s.updatedAt instanceof Date ? s.updatedAt.getTime() : new Date(s.updatedAt).getTime(),
            status: s.state?.currentState ?? 'active',
            createdAt: s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt).getTime(),
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
