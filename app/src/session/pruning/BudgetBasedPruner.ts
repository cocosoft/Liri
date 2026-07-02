import type { Session } from '../models/Session';
import type {
  PruningStrategy,
  PruningResult,
  PruningContext,
  PruningConfig,
} from './PruningStrategy';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'session:budgetPruner',
  level: LogLevel.INFO,
});

const DEFAULT_TOKEN_BUDGET = 50_000;

export class BudgetBasedPruner implements PruningStrategy {
  readonly name = 'BudgetBasedPruner';
  private tokenBudget: number;

  constructor(tokenBudget: number = DEFAULT_TOKEN_BUDGET) {
    this.tokenBudget = tokenBudget;
  }

  shouldPrune(context: PruningContext): boolean {
    if (!context.session || context.session.messages.length === 0) {
      return false;
    }
    return context.tokenUsage > this.tokenBudget;
  }

  prune(session: Session, config: PruningConfig): PruningResult {
    const before = session.messages.length;

    const preserveFirst = Math.min(config.preserveFirstMessages, before);
    const preserveLast = Math.min(config.preserveLastMessages, before);

    const firstBlock = session.messages.slice(0, preserveFirst);
    const lastBlock = session.messages.slice(-preserveLast);
    const middleBlock = session.messages.slice(
      preserveFirst,
      -preserveLast || before
    );

    let currentTokens = 0;
    const keptMiddle: typeof middleBlock = [];

    for (const msg of middleBlock) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      currentTokens += Math.ceil(content.length / 4);
    }

    const firstTokens = firstBlock.reduce((sum, msg) => {
      const content = typeof msg.content === 'string' ? msg.content : '';
      return sum + Math.ceil(content.length / 4);
    }, 0);

    const lastTokens = lastBlock.reduce((sum, msg) => {
      const content = typeof msg.content === 'string' ? msg.content : '';
      return sum + Math.ceil(content.length / 4);
    }, 0);

    const middleBudget = Math.max(
      0,
      this.tokenBudget - firstTokens - lastTokens
    );

    let prunedTokenEstimate = 0;
    let accumulatedTokens = 0;

    for (let i = middleBlock.length - 1; i >= 0; i--) {
      const msg = middleBlock[i];
      const content = typeof msg.content === 'string' ? msg.content : '';
      const msgTokens = Math.ceil(content.length / 4);

      if (accumulatedTokens + msgTokens <= middleBudget) {
        accumulatedTokens += msgTokens;
        keptMiddle.unshift(msg);
      } else {
        prunedTokenEstimate += msgTokens;
      }
    }

    session.messages = [...firstBlock, ...keptMiddle, ...lastBlock];

    logger.info('Budget-based pruning completed', {
      sessionId: session.id,
      removed: before - session.messages.length,
      remaining: session.messages.length,
      tokenEstimate: prunedTokenEstimate,
      budget: this.tokenBudget,
    });

    return {
      prunedMessageCount: before - session.messages.length,
      prunedTokenEstimate,
      messagesRemaining: session.messages.length,
      reason: `Budget-based pruning: removed ${before - session.messages.length} messages (token budget: ${this.tokenBudget})`,
    };
  }
}
