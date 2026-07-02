import type { Session } from '../models/Session';
import type {
  PruningStrategy,
  PruningResult,
  PruningContext,
  PruningConfig,
} from './PruningStrategy';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'session:softTrimmer',
  level: LogLevel.INFO,
});

export class SoftTrimmer implements PruningStrategy {
  readonly name = 'SoftTrimmer';

  shouldPrune(context: PruningContext): boolean {
    if (!context.session || context.session.messages.length < 10) {
      return false;
    }

    const threshold = context.modelContextWindow * 0.8;
    return context.tokenUsage > threshold;
  }

  prune(session: Session, config: PruningConfig): PruningResult {
    const before = session.messages.length;

    const preserveFirst = Math.min(
      config.preserveFirstMessages,
      session.messages.length
    );
    const preserveLast = Math.min(
      config.preserveLastMessages,
      session.messages.length
    );

    const firstBlock = session.messages.slice(0, preserveFirst);
    const lastBlock = session.messages.slice(-preserveLast);
    const middleBlock = session.messages.slice(
      preserveFirst,
      -preserveLast || session.messages.length
    );

    let prunedTokenEstimate = 0;
    const keptMiddle: Array<(typeof session.messages)[0]> = [];

    if (middleBlock.length > 10) {
      const trimmedCount = Math.floor(middleBlock.length * 0.3);
      const keepCount = middleBlock.length - trimmedCount;

      const step = keepCount > 0 ? middleBlock.length / keepCount : 1;
      for (let i = 0; i < middleBlock.length; i++) {
        if (
          Math.round(i / step) === Math.floor(i / step) ||
          keptMiddle.length < keepCount
        ) {
          keptMiddle.push(middleBlock[i]);
        } else {
          const content =
            typeof middleBlock[i].content === 'string'
              ? middleBlock[i].content
              : '';
          prunedTokenEstimate += Math.ceil(content.length / 4);
        }
      }
    } else {
      keptMiddle.push(...middleBlock);
    }

    session.messages = [...firstBlock, ...keptMiddle, ...lastBlock];

    logger.info('Soft trimming completed', {
      sessionId: session.id,
      removed: before - session.messages.length,
      remaining: session.messages.length,
      tokenEstimate: prunedTokenEstimate,
    });

    return {
      prunedMessageCount: before - session.messages.length,
      prunedTokenEstimate,
      messagesRemaining: session.messages.length,
      reason: `Soft trim: removed ${before - session.messages.length} messages from middle block`,
    };
  }
}
