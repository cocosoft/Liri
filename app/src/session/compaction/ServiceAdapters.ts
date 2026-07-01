import { AutoCompactService } from '@modules/services/compact/AutoCompactService';
import {
  SessionCheckpointService as RealCheckpointService,
  getCheckpointService,
} from '@modules/chat/services/SessionCheckpointService';
import type {
  AutoCompactServiceRef,
  SessionCheckpointService,
  SessionCheckpointHandle,
} from './SessionCompactionBridge';
import { SessionCompactionBridge } from './SessionCompactionBridge';
import { SummaryCompactor } from './SummaryCompactor';
import { LayeredCompactor } from './LayeredCompactor';
import { KeyInfoExtractor } from './KeyInfoExtractor';

export class AutoCompactServiceAdapter implements AutoCompactServiceRef {
  constructor(private real: AutoCompactService) {}

  checkAndCompact(
    sessionId: string,
    messages: unknown[],
    model: string
  ): { shouldCompact: boolean } {
    return this.real.checkAndCompact(sessionId, messages as never[], model);
  }

  async performAutoCompact(
    sessionId: string,
    messages: unknown[],
    model: string
  ): Promise<{ success: boolean; error?: string }> {
    const result = await this.real.performAutoCompact(
      sessionId,
      messages as never[],
      model
    );
    return { success: result.success, error: result.error };
  }
}

export class SessionCheckpointServiceAdapter implements SessionCheckpointService {
  constructor(private real: RealCheckpointService) {}

  async createCheckpoint(
    sessionId: string
  ): Promise<SessionCheckpointHandle | null> {
    try {
      const cp = await this.real.createCheckpoint({
        sessionId,
        autoCreated: true,
      });
      return { id: cp.id, createdAt: cp.createdAt };
    } catch {
      return null;
    }
  }
}

export function createWiredCompactionBridge(): SessionCompactionBridge {
  const bridge = new SessionCompactionBridge();

  const autoCompactService = new AutoCompactService();
  const adapter = new AutoCompactServiceAdapter(autoCompactService);
  bridge.setAutoCompactService(adapter);

  const checkpointService = getCheckpointService();
  bridge.setCheckpointService(
    new SessionCheckpointServiceAdapter(checkpointService)
  );

  // 注册分层压缩策略引擎
  bridge.registerEngine(new SummaryCompactor(100, 30, adapter));
  bridge.registerEngine(new LayeredCompactor(80, 20, adapter));
  bridge.registerEngine(new KeyInfoExtractor(60, adapter));

  return bridge;
}
