/**
 * ContextCollapse 类型定义
 */

import type { Message } from '@modules/chat/types/message';

export interface CollapseCommit {
  id: string;
  timestamp: number;
  sessionId: string;
  collapsedMessages: string[];
  summary: string;
}

export interface CollapseState {
  commits: CollapseCommit[];
  currentView: Message[];
}

export interface CollapseResult {
  messages: Message[];
  commitsAdded: number;
  tokensSaved: number;
}

export interface CollapseOptions {
  maxTokens: number;
  targetReduction: number;
  minMessagesToCollapse: number;
}

export interface CollapseStats {
  collapsedSpans: number;
  collapsedMessages: number;
  stagedSpans: number;
  health: {
    totalSpawns: number;
    totalErrors: number;
    totalEmptySpawns: number;
    lastError?: string;
  };
}
