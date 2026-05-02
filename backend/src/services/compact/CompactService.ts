/**
 * 压缩服务实现
 * 基于CC源码 cc_code/backend/services/compact/compact.ts 实现
 *
 * 支持AI驱动的对话压缩、边界检测、摘要生成、关键信息提取和制品注入。
 * 使用API轮次分组(groupMessagesByApiRound)确保压缩边界的语义完整性。
 */

import type { SessionMessage } from '../../session/models/SessionMessage';
import type { AIService, AIMessage } from '../../ai/models/types';
import { AIMessageRole, AIModelType } from '../../ai/models/types';
import { groupMessagesByApiRound, getMessageTextContent } from './grouping';
import { getCompactPrompt, getCompactUserSummaryMessage } from './prompt';
import { roughTokenCountEstimationForMessages } from './utils';

// autoCompact 阈值集成（基于CC源码 autoCompact.ts）
import {
  getCompactConfig,
  shouldAutoCompact,
  CompactCircuitBreaker,
} from './autoCompact';
import {
  executePreCompactHooks,
  executePostCompactHooks,
} from './compactHooks';

export const AUTOCOMPACT_THRESHOLDS = {
  BUFFER: 13_000,
  WARNING: 20_000,
  ERROR: 20_000,
  MANUAL: 3_000,
  MAX_CONSECUTIVE_FAILURES: 3,
} as const;

export interface CompactBoundary {
  sessionId: string;
  messageId: string;
  timestamp: Date;
  reason: 'length' | 'time' | 'manual' | 'auto';
  compressedMessages: string[];
  artifactReferences: string[];
}

export interface CompactArtifact {
  id: string;
  sessionId: string;
  type:
    | 'summary'
    | 'key_point'
    | 'code_snippet'
    | 'file_reference'
    | 'decision'
    | 'action_item';
  content: string;
  references: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CompactionResult {
  boundaryMarker: string;
  summaryMessages: string[];
  attachments: string[];
  hookResults: string[];
  messagesToKeep?: string[];
  userDisplayMessage?: string;
  preCompactTokenCount?: number;
  postCompactTokenCount?: number;
}

export interface CompactService {
  detectCompactBoundary(
    sessionId: string,
    messages: SessionMessage[]
  ): Promise<CompactBoundary | null>;
  performCompact(
    sessionId: string,
    messages: SessionMessage[]
  ): Promise<CompactArtifact[]>;
  generateCompactSummary(
    messages: SessionMessage[],
    sessionId: string
  ): Promise<CompactArtifact>;
  compactConversation(
    messages: SessionMessage[],
    options?: CompactConversationOptions
  ): Promise<CompactionResult>;
  partialCompactConversation(
    messages: SessionMessage[],
    pivotIndex: number,
    direction?: 'from' | 'up_to'
  ): Promise<CompactionResult>;
  extractKeyInformation(
    messages: SessionMessage[],
    sessionId: string
  ): Promise<CompactArtifact[]>;
  reinjectArtifacts(
    sessionId: string,
    artifacts: CompactArtifact[]
  ): Promise<void>;
  getSessionArtifacts(sessionId: string): Promise<CompactArtifact[]>;
}

export interface CompactConversationOptions {
  model?: string;
  customInstructions?: string;
  suppressFollowUpQuestions?: boolean;
  isAutoCompact?: boolean;
}

const DEFAULT_COMPACT_MODEL = AIModelType.CLAUDE_3_SONNET;
const SUMMARY_MAX_OUTPUT_TOKENS = 20000;

export class CompactServiceImpl implements CompactService {
  private boundaries: Map<string, CompactBoundary> = new Map();
  private artifacts: Map<string, CompactArtifact[]> = new Map();
  private aiService: AIService | null = null;

  constructor(aiService?: AIService) {
    if (aiService) {
      this.aiService = aiService;
    }
  }

  setAIService(service: AIService): void {
    this.aiService = service;
  }

  async detectCompactBoundary(
    sessionId: string,
    messages: SessionMessage[]
  ): Promise<CompactBoundary | null> {
    const totalTokens = roughTokenCountEstimationForMessages(messages);

    if (totalTokens > 80000) {
      const boundary: CompactBoundary = {
        sessionId,
        messageId: messages[messages.length - 1].id,
        timestamp: new Date(),
        reason: 'length',
        compressedMessages: messages.map((msg) => msg.id),
        artifactReferences: [],
      };
      this.boundaries.set(sessionId, boundary);
      return boundary;
    }

    if (messages.length > 1) {
      const firstMessage = messages[0];
      const lastMessage = messages[messages.length - 1];
      const timeDiff =
        lastMessage.createdAt.getTime() - firstMessage.createdAt.getTime();

      if (timeDiff > 24 * 60 * 60 * 1000) {
        const boundary: CompactBoundary = {
          sessionId,
          messageId: lastMessage.id,
          timestamp: new Date(),
          reason: 'time',
          compressedMessages: messages.map((msg) => msg.id),
          artifactReferences: [],
        };
        this.boundaries.set(sessionId, boundary);
        return boundary;
      }
    }

    return null;
  }

  async performCompact(
    sessionId: string,
    messages: SessionMessage[]
  ): Promise<CompactArtifact[]> {
    const artifacts: CompactArtifact[] = [];

    const summary = await this.generateCompactSummary(messages, sessionId);
    artifacts.push(summary);

    const keyInfo = await this.extractKeyInformation(messages, sessionId);
    artifacts.push(...keyInfo);

    this.artifacts.set(sessionId, artifacts);

    const boundary = this.boundaries.get(sessionId);
    if (boundary) {
      boundary.artifactReferences = artifacts.map((artifact) => artifact.id);
    }

    return artifacts;
  }

  async generateCompactSummary(
    messages: SessionMessage[],
    sessionId: string
  ): Promise<CompactArtifact> {
    let summary: string;

    if (this.aiService) {
      summary = await this.generateAISummary(messages);
    } else {
      summary = this.generateBasicSummary(messages);
    }

    return {
      id: `summary_${Date.now()}`,
      sessionId,
      type: 'summary',
      content: summary,
      references: messages.map((msg) => msg.id),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private async generateAISummary(messages: SessionMessage[]): Promise<string> {
    if (!this.aiService) {
      return this.generateBasicSummary(messages);
    }

    const prompt = getCompactPrompt();
    const aiMessages: AIMessage[] = [
      { role: AIMessageRole.SYSTEM, content: prompt },
      {
        role: AIMessageRole.USER,
        content: 'Please summarize the following conversation:\n\n' +
          messages.map((msg) => `[${msg.type}] ${msg.content.substring(0, 2000)}`).join('\n\n'),
      },
    ];

    try {
      const response = await this.aiService.generate(aiMessages, DEFAULT_COMPACT_MODEL, {
        max_tokens: SUMMARY_MAX_OUTPUT_TOKENS,
        temperature: 0.3,
      });
      return response.content;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return `[AI summary generation failed: ${errorMsg}]\n\n${this.generateBasicSummary(messages)}`;
    }
  }

  private generateBasicSummary(messages: SessionMessage[]): string {
    let summary = 'Session Summary:\n\n';
    const groups = groupMessagesByApiRound(
      messages.map((m) => ({
        id: m.id,
        role: m.type as any,
        content: m.content,
        createdAt: m.createdAt,
        updatedAt: m.createdAt,
      })) as any
    );

    groups.forEach((group, index) => {
      const userMsgs = group.filter((m) => m.role === 'user');
      const assistantMsgs = group.filter((m) => m.role === 'assistant');

      if (userMsgs.length > 0) {
        const text = getMessageTextContent(userMsgs[userMsgs.length - 1]);
        summary += `Round ${index + 1} - User: ${text.substring(0, 300)}${text.length > 300 ? '...' : ''}\n`;
      }
      if (assistantMsgs.length > 0) {
        const text = getMessageTextContent(assistantMsgs[assistantMsgs.length - 1]);
        summary += `Round ${index + 1} - Assistant: ${text.substring(0, 300)}${text.length > 300 ? '...' : ''}\n`;
      }
    });

    return summary;
  }

  async compactConversation(
    messages: SessionMessage[],
    options?: CompactConversationOptions
  ): Promise<CompactionResult> {
    const preCompactTokenCount = roughTokenCountEstimationForMessages(messages);
    const groups = groupMessagesByApiRound(
      messages.map((m) => ({
        id: m.id,
        role: m.type as any,
        content: m.content,
        createdAt: m.createdAt,
        updatedAt: m.createdAt,
      })) as any
    );

    let summary: string;
    if (this.aiService) {
      summary = await this.generateAISummary(messages);
    } else {
      summary = this.generateBasicSummary(messages);
    }

    const boundaryMarker = `[Compaction boundary - ${options?.isAutoCompact ? 'auto' : 'manual'} - ${new Date().toISOString()}]`;

    const summaryMessage = getCompactUserSummaryMessage(summary);

    const groupsToKeep = options?.isAutoCompact
      ? groups.slice(-Math.min(2, groups.length))
      : groups.slice(-Math.min(3, groups.length));

    const messagesToKeep = groupsToKeep
      .flat()
      .filter((m: any) => messages.some((sm) => sm.id === m.id))
      .map((m: any) => m.id);

    return {
      boundaryMarker,
      summaryMessages: [summaryMessage],
      attachments: [],
      hookResults: [],
      messagesToKeep,
      preCompactTokenCount,
      postCompactTokenCount: preCompactTokenCount
        ? Math.round(preCompactTokenCount * 0.3)
        : undefined,
    };
  }

  async partialCompactConversation(
    messages: SessionMessage[],
    pivotIndex: number,
    direction: 'from' | 'up_to' = 'from'
  ): Promise<CompactionResult> {
    const preCompactTokenCount = roughTokenCountEstimationForMessages(messages);

    const messagesToSummarize = direction === 'up_to'
      ? messages.slice(0, pivotIndex)
      : messages.slice(pivotIndex);

    const messagesToKeepIndices = direction === 'up_to'
      ? messages.slice(pivotIndex).map((m) => m.id)
      : messages.slice(0, pivotIndex).map((m) => m.id);

    let summary: string;
    if (this.aiService) {
      summary = await this.generateAISummary(messagesToSummarize);
    } else {
      const basicSummary = 'Partial Session Summary:\n\n';
      summary = basicSummary + messagesToSummarize
        .map((msg) => `[${msg.type}] ${msg.content.substring(0, 200)}`)
        .join('\n');
    }

    const boundaryMarker = `[Partial compaction boundary - ${direction} - ${new Date().toISOString()}]`;
    const summaryMessage = getCompactUserSummaryMessage(summary);

    return {
      boundaryMarker,
      summaryMessages: [summaryMessage],
      attachments: [],
      hookResults: [],
      messagesToKeep: messagesToKeepIndices,
      preCompactTokenCount,
    };
  }

  async extractKeyInformation(
    messages: SessionMessage[],
    sessionId: string
  ): Promise<CompactArtifact[]> {
    const artifacts: CompactArtifact[] = [];

    messages.forEach((msg) => {
      if (msg.content.includes('```')) {
        artifacts.push({
          id: `code_${Date.now()}_${artifacts.length}`,
          sessionId,
          type: 'code_snippet',
          content: msg.content,
          references: [msg.id],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    });

    const decisionKeywords = ['decide', 'decision', '决定', '选择', '决策'];
    messages.forEach((msg) => {
      if (
        decisionKeywords.some((keyword) =>
          msg.content.toLowerCase().includes(keyword)
        )
      ) {
        artifacts.push({
          id: `decision_${Date.now()}_${artifacts.length}`,
          sessionId,
          type: 'decision',
          content: msg.content,
          references: [msg.id],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    });

    const actionKeywords = ['action', 'todo', '任务', '需要做', '接下来'];
    messages.forEach((msg) => {
      if (
        actionKeywords.some((keyword) =>
          msg.content.toLowerCase().includes(keyword)
        )
      ) {
        artifacts.push({
          id: `action_${Date.now()}_${artifacts.length}`,
          sessionId,
          type: 'action_item',
          content: msg.content,
          references: [msg.id],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    });

    return artifacts;
  }

  async reinjectArtifacts(
    sessionId: string,
    artifacts: CompactArtifact[]
  ): Promise<void> {
    const existing = this.artifacts.get(sessionId) || [];
    const existingIds = new Set(existing.map((a) => a.id));
    const newArtifacts = artifacts.filter((a) => !existingIds.has(a.id));
    this.artifacts.set(sessionId, [...existing, ...newArtifacts]);
  }

  async getSessionArtifacts(sessionId: string): Promise<CompactArtifact[]> {
    return this.artifacts.get(sessionId) || [];
  }

  clearSessionArtifacts(sessionId: string): void {
    this.artifacts.delete(sessionId);
    this.boundaries.delete(sessionId);
  }
}
