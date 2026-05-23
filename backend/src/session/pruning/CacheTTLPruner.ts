import type { Session } from '../models/Session';
import type {
  PruningStrategy,
  PruningResult,
  PruningContext,
  PruningConfig,
} from './PruningStrategy';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export class CacheTTLPruner implements PruningStrategy {
  readonly name = 'CacheTTLPruner';

  shouldPrune(context: PruningContext): boolean {
    if (!context.session || context.session.messages.length === 0) {
      return false;
    }

    const threshold = context.modelContextWindow * 0.8;
    return context.tokenUsage > threshold;
  }

  prune(session: Session, config: PruningConfig): PruningResult {
    const before = session.messages.length;
    const now = Date.now();
    const ttl = config.messageTtlMs;

    const preserveIndices = new Set<number>();
    for (
      let i = 0;
      i < config.preserveFirstMessages && i < session.messages.length;
      i++
    ) {
      preserveIndices.add(i);
    }
    for (
      let i = 0;
      i < config.preserveLastMessages && i < session.messages.length;
      i++
    ) {
      preserveIndices.add(session.messages.length - 1 - i);
    }

    let prunedTokenEstimate = 0;
    const kept: Array<(typeof session.messages)[0]> = [];

    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i];
      if (preserveIndices.has(i)) {
        kept.push(msg);
        continue;
      }

      const msgAge = msg.createdAt ? now - msg.createdAt.getTime() : 0;
      if (msgAge < ttl) {
        kept.push(msg);
      } else {
        const content = typeof msg.content === 'string' ? msg.content : '';
        prunedTokenEstimate += Math.ceil(content.length / 4);
      }
    }

    session.messages = kept;

    logger.info('TTL pruning completed', {
      sessionId: session.id,
      removed: before - kept.length,
      remaining: kept.length,
      tokenEstimate: prunedTokenEstimate,
    });

    return {
      prunedMessageCount: before - kept.length,
      prunedTokenEstimate,
      messagesRemaining: kept.length,
      reason: `TTL pruning: removed ${before - kept.length} messages older than ${ttl}ms`,
    };
  }
}
