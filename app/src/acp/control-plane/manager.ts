import { AcpSessionManagerCore } from './manager.core.js';
import type {
  AcpSessionManagerConfig,
  AcpSessionManagerEvents,
} from './manager.types.js';
import { resolveRuntimeOptions } from './runtime-options.js';
import type {
  AcpRuntimeEnsureInput,
  AcpRuntimeTurnInput,
  AcpRuntimeEvent,
} from '../runtime/types.js';
import type { SessionId } from '../types.js';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = getLogger('acp:manager');

export class AcpSessionManager {
  private core: AcpSessionManagerCore;
  private config: AcpSessionManagerConfig;

  constructor(
    config: AcpSessionManagerConfig,
    events?: Partial<AcpSessionManagerEvents>
  ) {
    this.config = config;
    this.core = new AcpSessionManagerCore(config, events);
  }

  getCore(): AcpSessionManagerCore {
    return this.core;
  }

  getConfig(): AcpSessionManagerConfig {
    return this.config;
  }

  getRuntimeOptions(): ReturnType<typeof resolveRuntimeOptions> {
    return resolveRuntimeOptions(this.config.serverOptions);
  }

  async createSession(input: AcpRuntimeEnsureInput): Promise<boolean> {
    try {
      await this.core.createSession(input);
      return true;
    } catch (e) {
      void handleError(e, { module: 'acp:manager', action: 'createSession' });
      return false;
    }
  }

  async runTurn(
    input: AcpRuntimeTurnInput
  ): Promise<AsyncIterable<AcpRuntimeEvent>> {
    return this.core.runTurn(input);
  }

  async cancelSession(sessionId: SessionId): Promise<void> {
    await this.core.cancelSession(sessionId);
  }

  async closeSession(sessionId: SessionId, reason: string): Promise<void> {
    await this.core.closeSession(sessionId, reason);
  }

  async closeAll(reason: string): Promise<void> {
    await this.core.closeAll(reason);
  }

  getStats(): {
    sessions: number;
    clients: number;
    activeRuns: number;
  } {
    return {
      sessions: this.core.getSessionCount(),
      clients: this.core.getClientCount(),
      activeRuns: this.core.getActiveRunCount(),
    };
  }
}

export function createAcpSessionManager(
  config: AcpSessionManagerConfig,
  events?: Partial<AcpSessionManagerEvents>
): AcpSessionManager {
  return new AcpSessionManager(config, events);
}
