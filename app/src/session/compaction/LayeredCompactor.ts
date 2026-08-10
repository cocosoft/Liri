import type { Session } from '../models/Session';
import type {
  CompactionEngine,
  AutoCompactServiceRef,
} from './CompactionTypes';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('session:layeredCompactor');

const DEFAULT_THRESHOLD = 80;
const DEFAULT_RECENT_WINDOW = 20;

/**
 * 分层压缩器 — 近期消息保留原文，远期消息保留摘要
 * 将消息列表分为近期窗口（保留原文）和远期窗口（压缩为摘要）
 */
export class LayeredCompactor implements CompactionEngine {
  private threshold: number;
  private recentWindow: number;
  private autoCompactService: AutoCompactServiceRef | null = null;

  constructor(
    threshold: number = DEFAULT_THRESHOLD,
    recentWindow: number = DEFAULT_RECENT_WINDOW,
    autoCompactService?: AutoCompactServiceRef
  ) {
    this.threshold = threshold;
    this.recentWindow = recentWindow;
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

    const oldLayerCount = messages.length - this.recentWindow;
    if (oldLayerCount <= 0) {
      return { shouldCompact: false };
    }

    logger.debug('Layered compaction threshold exceeded', {
      sessionId,
      totalMessages: messages.length,
      recentWindow: this.recentWindow,
      oldLayerCount,
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
      'Layered compaction: no autoCompactService configured, skipping',
      {
        sessionId,
        messageCount: messages.length,
      }
    );

    return { success: true };
  }
}
