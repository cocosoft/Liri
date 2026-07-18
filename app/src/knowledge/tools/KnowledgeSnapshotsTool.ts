// MIT License
// Copyright (c) 2026 190615273@qq.com
// (SPDX-License-Identifier: MIT)

/**
 * KnowledgeSnapshotsTool — 查看文档的历史版本快照
 */
import { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import { ToolUseContext } from '../../tools/types/ToolUseContext';
import { KnowledgeBaseWriter } from '../KnowledgeBaseWriter';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'knowledge:tools:KnowledgeSnapshotsTool', level: LogLevel.INFO });

export class KnowledgeSnapshotsTool implements Tool {
  public name: string = 'knowledge_snapshots';
  public description: string =
    'List all saved snapshot versions of a knowledge document. Use this to browse version history before restoring.';
  public params: ToolParam[] = [
    {
      name: 'title',
      type: 'string',
      description: 'Title of the document to list snapshots for',
      required: true,
    },
  ];
  public aliases: string[] = ['knowledge_history', 'kb_snapshots'];
  public searchTips: string[] = ['knowledge', 'snapshot', 'history', 'version'];
  public isEnabled: () => boolean = () => true;
  public isReadOnly: () => boolean = () => true;
  public isDestructive: () => boolean = () => false;
  public isConcurrencySafe: () => boolean = () => true;

  private writer: KnowledgeBaseWriter;

  constructor() {
    this.writer = new KnowledgeBaseWriter();
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const title = ((input.title as string) || '').trim();

    if (!title) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: 'title is required',
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_snapshots_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    try {
      const snapshots = await this.writer.listSnapshots(title);

      if (snapshots.length === 0) {
        return {
          status: ToolExecutionStatus.SUCCESS,
          output: 'No snapshots found.',
          executionTime: Date.now() - startTime,
          error: '',
          errorOutput: '',
          progress: [],
          metadata: { count: 0 },
          executionId: `knowledge_snapshots_${Date.now()}`,
          toolName: this.name,
          timestamp: Date.now(),
          content: `文档 "${title}" 没有历史版本快照。`,
        };
      }

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: snapshots,
        output: JSON.stringify(snapshots),
        executionTime: Date.now() - startTime,
        error: '',
        errorOutput: '',
        progress: [],
        metadata: { count: snapshots.length, title },
        executionId: `knowledge_snapshots_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
        content: `文档 "${title}" 有 ${snapshots.length} 个历史版本:\n${snapshots.map((s) => `  - ${s}`).join('\n')}`,
      };
    } catch (error) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_snapshots_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  }

  getInfo(): ToolInfo {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: this.aliases,
      searchTips: this.searchTips,
      enabled: this.isEnabled(),
      readOnly: this.isReadOnly(),
      destructive: this.isDestructive(),
      concurrencySafe: this.isConcurrencySafe(),
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block',
    };
  }
}

export function createKnowledgeSnapshotsTool(): Tool {
  return new KnowledgeSnapshotsTool();
}
