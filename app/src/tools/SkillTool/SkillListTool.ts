// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * SkillListTool — skills_list（T9'，2026-08-30，对齐 hermes-agent 渐进式披露 tier 1）
 *
 * 列出全部可用技能元数据（name + description，token 高效），不加载正文。
 * 完整内容由 skill_view(name) 按需加载（tier 2-3）。
 * 仅列 SkillTool 可执行的 prompt 型 + 启用技能（展示=可执行，BUG-2 对齐）。
 */

import { Tool, ToolInfo, ToolTag } from '../types/Tool';
import { ToolResult, ToolExecutionStatus } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getSkillRegistryLazy } from './skillRegistryAccess';

const logger = getLogger('tools:SkillTool:SkillListTool');

/**
 * SkillListTool参数定义（无必填参数；category 过滤留待后续）
 */
const SKILL_LIST_PARAMS: Tool['params'] = [];

/**
 * SkillListTool实现
 */
export class SkillListTool implements Tool {
  /** 工具名称 */
  readonly name: string = 'skills_list';

  /** 工具描述 */
  readonly description: string =
    'List available skills (name + description). Use skill_view(name) to load full content.';

  /** 工具参数 */
  readonly params = SKILL_LIST_PARAMS;

  /** 搜索提示 */
  readonly searchHint?: string = 'list skills';

  /**
   * 获取工具信息
   */
  getInfo(): ToolInfo {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: undefined,
      searchTips: undefined,
      enabled: true,
      readOnly: true,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block',
      tags: [ToolTag.AGENT],
    };
  }

  /**
   * 检查工具是否启用
   */
  isEnabled(): boolean {
    return true;
  }

  /**
   * 只读工具
   */
  isReadOnly(_input?: Record<string, unknown>): boolean {
    return true;
  }

  /**
   * 非破坏性
   */
  isDestructive(_input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 并发安全
   */
  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  /**
   * 中断行为
   */
  interruptBehavior(): 'cancel' | 'block' {
    return 'block';
  }

  /**
   * 列出技能元数据
   */
  async execute(
    _input: Record<string, unknown>,
    _context?: ToolUseContext
  ): Promise<ToolResult<unknown>> {
    return getOTelTracing().wrap(
      { name: 'skill.list', attributes: { tool: this.name } },
      async () => {
        try {
          const registry = getSkillRegistryLazy();
          const skills = registry?.getAll({ includeDisabled: false }) ?? [];
          const list = skills
            .filter(
              (s) =>
                s.impl.kind === 'prompt' &&
                !(s.isEnabled && s.isEnabled() === false)
            )
            .map((s) => ({ name: s.name, description: s.description || '' }));
          logger.info('skills_list', { total: list.length });
          return {
            status: ToolExecutionStatus.SUCCESS,
            toolName: this.name,
            result: { skills: list, total: list.length },
          };
        } catch (err) {
          // §1.9：统一 handleError（Logger + ErrorTracker），工具失败以结构化结果返回
          await handleError(err, {
            module: 'tools:SkillTool:SkillListTool',
            action: 'execute',
          }).catch(() => {});
          return {
            status: ToolExecutionStatus.FAILURE,
            toolName: this.name,
            result: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    )();
  }
}
