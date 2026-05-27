import type { Context } from './Context';

export interface ToolUseContext extends Context {
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
}
