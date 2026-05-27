import type { Context } from './Context';

export interface SessionContext extends Context {
  sessionId: string;
}
