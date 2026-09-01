import type { SessionId } from '../types.js';
import type {
  AcpRuntimeHandle,
  AcpRuntimeEnsureInput,
  AcpRuntimeTurnInput,
  AcpRuntimeEvent,
} from '../runtime/types.js';
import type {
  AcpSessionManagerConfig,
  AcpSessionManagerState,
  AcpSessionManagerEvents,
} from './manager.types.js';
import { getSessionActorQueue } from './session-actor-queue.js';
import { handleError } from '@modules/error/handleError';

export class AcpSessionManagerCore {
  private config: AcpSessionManagerConfig;
  private state: AcpSessionManagerState;
  private events: AcpSessionManagerEvents;

  constructor(
    config: AcpSessionManagerConfig,
    events?: Partial<AcpSessionManagerEvents>
  ) {
    this.config = config;
    this.state = {
      sessions: new Map(),
      clients: new Map(),
      activeRuns: new Map(),
    };
    this.events = {
      onSessionCreated: events?.onSessionCreated || (() => {}),
      onSessionClosed: events?.onSessionClosed || (() => {}),
      onError: events?.onError || (() => {}),
    };
  }

  async createSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle> {
    const handle = await this.config.runtime.ensureSession(input);
    const session = await this.config.sessionStore.create({
      sessionKey: input.sessionKey,
      cwd: input.cwd,
    });
    this.state.sessions.set(session.sessionId, handle);
    this.events.onSessionCreated(session.sessionId);
    return handle;
  }

  async runTurn(
    input: AcpRuntimeTurnInput
  ): Promise<AsyncIterable<AcpRuntimeEvent>> {
    const queue = getSessionActorQueue(input.handle.sessionKey);
    return queue.enqueue(async () => {
      const abortController = new AbortController();
      const runId = `run-${Date.now()}`;
      this.state.activeRuns.set(runId, abortController);

      try {
        const turnInput: AcpRuntimeTurnInput = {
          ...input,
          signal: input.signal || abortController.signal,
        };
        const events = await this.config.runtime.runTurn(turnInput);
        return events;
      } catch (err) {
        // @ignore-catch — 确保 activeRuns 清理后重新抛出
        void handleError(err, { module: 'acp:core', action: 'runTurn' });
        throw err;
      } finally {
        this.state.activeRuns.delete(runId);
      }
    });
  }

  async cancelSession(sessionId: SessionId): Promise<void> {
    const handle = this.state.sessions.get(sessionId);
    if (handle) {
      await this.config.runtime.cancel({ handle });
    }
  }

  async closeSession(sessionId: SessionId, reason: string): Promise<void> {
    const handle = this.state.sessions.get(sessionId);
    if (handle) {
      await this.config.runtime.close({ handle, reason });
      this.state.sessions.delete(sessionId);
      await this.config.sessionStore.delete(sessionId);
      this.events.onSessionClosed(sessionId);
    }
  }

  getSessionCount(): number {
    return this.state.sessions.size;
  }

  getClientCount(): number {
    return this.state.clients.size;
  }

  getActiveRunCount(): number {
    return this.state.activeRuns.size;
  }

  async closeAll(reason: string): Promise<void> {
    const closePromises: Promise<void>[] = [];
    for (const [sessionId, handle] of this.state.sessions) {
      closePromises.push(
        this.config.runtime.close({ handle, reason }).catch((err) => {
          void handleError(err, { module: 'acp:core', action: 'closeAll' });
          this.events.onError(
            err instanceof Error ? err : new Error(String(err))
          );
        })
      );
      this.state.sessions.delete(sessionId);
      this.events.onSessionClosed(sessionId);
    }
    await Promise.all(closePromises);
  }
}
