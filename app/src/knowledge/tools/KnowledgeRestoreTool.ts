// MIT License
// Copyright (c) 2026 190615273@qq.com
// (SPDX-License-Identifier: MIT)

/**
 * KnowledgeRestoreTool — 从快照恢复文档
 *
 * 恢复前也会自动创建当前版本的快照，确保操作可回滚。
 */
import { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import { ToolUseContext } from '../../tools/types/ToolUseContext';
import { KnowledgeBaseWriter } from '../KnowledgeBaseWriter';
import { globalEventBus } from '@modules/core';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('knowledge:tools:knowledgeRestoreTool');

export class KnowledgeRestoreTool implements Tool {
  public name: string = 'knowledge_restore';
  public description: string =
    'Restore a knowledge document to a previous version from its snapshot history. Use knowledge_snapshots first to see available versions.';
  public params: ToolParam[] = [
    {
      name: 'title',
      type: 'string',
      description: 'Title of the document to restore',
      required: true,
    },
    {
      name: 'snapshot',
      type: 'string',
      description:
        'Snapshot filename to restore (e.g. "snapshot_2026-07-12T05-30-00-000Z.md"). Get this from knowledge_snapshots.',
      required: true,
    },
    {
      name: 'confirm',
      type: 'boolean',
      description: 'Must be set to true to confirm restoration.',
      required: true,
    },
  ];
  public aliases: string[] = ['knowledge_revert', 'kb_restore'];
  public searchTips: string[] = [
    'knowledge',
    'restore',
    'revert',
    'rollback',
    'version',
  ];
  public isEnabled: () => boolean = () => true;
  public isReadOnly: () => boolean = () => false;
  public isDestructive: () => boolean = () => true;
  public isConcurrencySafe: () => boolean = () => false;

  private writer: KnowledgeBaseWriter;

  constructor() {
    this.writer = new KnowledgeBaseWriter(undefined, globalEventBus);
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const title = ((input.title as string) || '').trim();
    const snapshot = ((input.snapshot as string) || '').trim();
    const confirm = input.confirm === true;

    if (!title || !snapshot) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: 'title and snapshot are required',
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_restore_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    if (!confirm) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error:
          'Restoration requires explicit confirmation. Set confirm=true to proceed.',
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_restore_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    try {
      const content = await this.writer.restoreSnapshot(title, snapshot);
      const success = content !== null;

      if (!success) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: `Snapshot "${snapshot}" not found for document "${title}".`,
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: '',
          progress: [],
          metadata: {},
          executionId: `knowledge_restore_${Date.now()}`,
          toolName: this.name,
          timestamp: Date.now(),
        };
      }

      logger.info('知识文档已从快照恢复', { title, snapshot });

      return {
        status: ToolExecutionStatus.SUCCESS,
        output: `Document "${title}" restored from snapshot successfully.`,
        executionTime: Date.now() - startTime,
        error: '',
        errorOutput: '',
        progress: [],
        metadata: { title, snapshot },
        executionId: `knowledge_restore_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
        content: `文档 "${title}" 已从快照 ${snapshot} 恢复成功。`,
      };
    } catch (error) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: error instanceof Error ? error.stack || '' : String(error),
        progress: [],
        metadata: {},
        executionId: `knowledge_restore_${Date.now()}`,
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

export function createKnowledgeRestoreTool(): Tool {
  return new KnowledgeRestoreTool();
}
