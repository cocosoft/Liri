import type { Session } from '../models/Session';
import type {
  CompactionEngine,
  AutoCompactServiceRef,
} from './CompactionTypes';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('session:summaryCompactor');

const DEFAULT_SUMMARY_THRESHOLD = 100;
const DEFAULT_SUMMARY_KEEP_RECENT = 30;

/**
 * 摘要压缩器 — 当消息数超过阈值时，对旧消息生成摘要替换原文
 * 保留最近 N 条消息原文，其余消息委托 AutoCompactService 压缩为摘要
 */
export class SummaryCompactor implements CompactionEngine {
  private threshold: number;
  private keepRecent: number;
  private autoCompactService: AutoCompactServiceRef | null = null;

  constructor(
    threshold: number = DEFAULT_SUMMARY_THRESHOLD,
    keepRecent: number = DEFAULT_SUMMARY_KEEP_RECENT,
    autoCompactService?: AutoCompactServiceRef
  ) {
    this.threshold = threshold;
    this.keepRecent = keepRecent;
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

    const oldCount = messages.length - this.keepRecent;
    if (oldCount <= 0) {
      return { shouldCompact: false };
    }

    logger.debug('Summary compaction threshold exceeded', {
      sessionId,
      totalMessages: messages.length,
      oldMessages: oldCount,
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
      'Summary compaction: no autoCompactService configured, skipping',
      {
        sessionId,
        messageCount: messages.length,
      }
    );

    return { success: true };
  }
}
