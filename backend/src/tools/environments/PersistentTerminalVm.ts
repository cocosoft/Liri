export interface PersistentTerminalSession {
  readonly sessionId: string;
  readonly createdAt: number;

  writeStdin(data: string): void;
  readStdout(maxLines?: number): string;
  readStderr(maxLines?: number): string;
  isAlive(): boolean;
  terminate(): void;
  setSudoPassword(password: string): void;
}

export class PersistentTerminalVm {
  private sessions: Map<string, PersistentTerminalSession> = new Map();

  createSession(sessionId: string): PersistentTerminalSession {
    throw new Error(
      'PersistentTerminalVm.createSession() requires a concrete process VM implementation'
    );
  }

  getSession(sessionId: string): PersistentTerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  terminateAll(): void {
    for (const [, session] of this.sessions) {
      try {
        session.terminate();
      } catch {}
    }
    this.sessions.clear();
  }

  getActiveCount(): number {
    return this.sessions.size;
  }
}

export const persistentTerminalVm = new PersistentTerminalVm();
