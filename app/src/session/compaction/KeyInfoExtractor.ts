import type { Session } from '../models/Session';
import type {
  CompactionEngine,
  AutoCompactServiceRef,
} from './CompactionTypes';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('session:keyInfoExtractor');

const DEFAULT_THRESHOLD = 60;

/**
 * 关键信息提取器 — 从消息中提取决策、TODO、文件变更等关键信息
 * 当消息数超过阈值时触发，提取关键信息并保留，非关键消息委托压缩
 */
export class KeyInfoExtractor implements CompactionEngine {
  private threshold: number;
  private autoCompactService: AutoCompactServiceRef | null = null;

  constructor(
    threshold: number = DEFAULT_THRESHOLD,
    autoCompactService?: AutoCompactServiceRef
  ) {
    this.threshold = threshold;
    this.autoCompactService = autoCompactService ?? null;
  }

  setAutoCompactService(service: AutoCompactServiceRef): void {
    this.autoCompactService = service;
  }

  checkAndCompact(
    sessionId: string,
    messages: Session['messages'],
    _model: string
  ): { shouldCompact: boolean } {
    if (messages.length <= this.threshold) {
      return { shouldCompact: false };
    }

    logger.debug('Key info extraction threshold exceeded', {
      sessionId,
      totalMessages: messages.length,
      threshold: this.threshold,
    });

    return { shouldCompact: true };
  }

  async performAutoCompact(
    sessionId: string,
    messages: Session['messages'],
    model: string
  ): Promise<{ success: boolean; error?: string }> {
    if (this.autoCompactService) {
      return this.autoCompactService.performAutoCompact(
        sessionId,
        messages,
        model
      );
    }

    logger.info(
      'Key info extraction: no autoCompactService configured, skipping',
      {
        sessionId,
        messageCount: messages.length,
      }
    );

    return { success: true };
  }
}
