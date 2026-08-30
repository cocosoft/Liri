// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * SkillViewTool — skill_view（T9'，2026-08-30，对齐 hermes-agent 渐进式披露 tier 2-3）
 *
 * 按技能名加载完整内容：优先读 SKILL.md 原文（用户/第三方技能，含 frontmatter），
 * 回退调用 prompt 型技能的 getPromptForCommand() 生成提示词。供模型在需要时
 * 按需加载，避免全部技能正文常驻上下文（渐进式披露）。
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { Tool, ToolInfo, ToolTag } from '../types/Tool';
import { ToolResult, ToolExecutionStatus } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getSkillRegistryLazy } from './skillRegistryAccess';

const logger = getLogger('tools:SkillTool:SkillViewTool');

/**
 * SkillViewTool参数定义
 */
const SKILL_VIEW_PARAMS: Tool['params'] = [
  {
    name: 'name',
    type: 'string',
    description: 'The skill name (use skills_list to see available skills)',
    required: true,
  },
];

/**
 * SkillViewTool实现
 */
export class SkillViewTool implements Tool {
  /** 工具名称 */
  readonly name: string = 'skill_view';

  /** 工具描述 */
  readonly description: string =
    "Load a skill's full content by name. Use skills_list to see available skills.";

  /** 工具参数 */
  readonly params = SKILL_VIEW_PARAMS;

  /** 搜索提示 */
  readonly searchHint?: string = 'view skill content';

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
   * 加载技能完整内容
   */
  async execute(
    input: Record<string, unknown>,
    _context?: ToolUseContext
  ): Promise<ToolResult<unknown>> {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) {
      return {
        status: ToolExecutionStatus.FAILURE,
        toolName: this.name,
        result: null,
        error: 'skill_view 需要 name 参数（可用 skills_list 查看可用技能名）',
      };
    }

    return getOTelTracing().wrap(
      {
        name: 'skill.view',
        attributes: { tool: this.name, 'skills.name': name },
      },
      async () => {
        try {
          const registry = getSkillRegistryLazy();
          const skill = registry?.get(name, { includeDisabled: false });
          if (!skill) {
            logger.warn('skill_view 未找到技能', { skillName: name });
            return {
              status: ToolExecutionStatus.FAILURE,
              toolName: this.name,
              result: null,
              error: `Skill '${name}' not found（可用 skills_list 查看可用技能）`,
            };
          }

          // 优先读 SKILL.md 原文（用户/第三方技能，含 frontmatter 与完整说明）
          if (skill.skillRoot) {
            try {
              const md = await readFile(
                join(skill.skillRoot, 'SKILL.md'),
                'utf-8'
              );
              logger.info('skill_view 返回 SKILL.md', {
                skillName: name,
                chars: md.length,
              });
              return {
                status: ToolExecutionStatus.SUCCESS,
                toolName: this.name,
                result: { name, source: 'SKILL.md', content: md },
              };
            } catch {
              // SKILL.md 不可读 → 回退 prompt 生成
            }
          }

          // 回退：prompt 型技能生成提示词
          if (skill.impl.kind === 'prompt') {
            const prompts = await skill.impl.getPromptForCommand({}, {});
            const content = prompts.map((p) => p.text).join('\n');
            logger.info('skill_view 返回生成 prompt', {
              skillName: name,
              chars: content.length,
            });
            return {
              status: ToolExecutionStatus.SUCCESS,
              toolName: this.name,
              result: { name, source: 'prompt', content },
            };
          }

          return {
            status: ToolExecutionStatus.FAILURE,
            toolName: this.name,
            result: null,
            error: `Skill '${name}' 不支持内容查看（非 prompt 型）`,
          };
        } catch (err) {
          // §1.9：统一 handleError（Logger + ErrorTracker），工具失败以结构化结果返回
          await handleError(err, {
            module: 'tools:SkillTool:SkillViewTool',
            action: 'execute',
            context: { skillName: name },
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
