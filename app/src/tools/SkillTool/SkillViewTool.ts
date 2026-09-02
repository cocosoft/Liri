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
import { skillUsageTracker } from '@modules/skills/services/SkillUsageTracker';

const logger = getLogger('tools:SkillTool:SkillViewTool');

/**
 * P0-1（2026-09-02，对标 hermes skill_view 去重）：同一会话内同一技能内容未变化时，
 * 返回 status:"unchanged" stub——根治"模型反复 skill_view 加载同一技能"（实测曾
 * skill_view(zhihu) 连续 8 次，上下文膨胀 + 触发循环检测）。映射：sessionId → 技能名 → 内容 hash。
 */
const VIEW_CACHE = new Map<string, Map<string, number>>();

/** 简单内容 hash（djb2）——避免引入依赖 */
function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/**
 * SkillViewTool参数定义
 */
const SKILL_VIEW_PARAMS: Tool['params'] = [
  {
    name: 'name',
    type: 'string',
    description:
      'The skill name (use skills_list to see available skills). 参数名 name 或 skillName 均可。',
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
    // 2026-09-01：参数名容错——模型常以 skillName 传参（deepseek 实测反复
    // skill_view 传 skillName 致连续无效回合熔断 circuit_breaker），兼容 name/skillName。
    const name =
      (typeof input.name === 'string' ? input.name.trim() : '') ||
      (typeof input.skillName === 'string' ? input.skillName.trim() : '');
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
              // P0-1：同会话同技能内容未变化 → unchanged stub（根治反复加载）
              const unchanged = this.checkUnchanged(_context?.sessionId, name, md);
              if (unchanged) return unchanged;
              // P2-2：技能使用遥测——实际加载成功才计数（unchanged 不计）
              void skillUsageTracker.bumpView(name);
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
            // P0-1：同会话同技能内容未变化 → unchanged stub
            const unchanged = this.checkUnchanged(
              _context?.sessionId,
              name,
              content
            );
            if (unchanged) return unchanged;
            // P2-2：技能使用遥测——实际加载成功才计数（unchanged 不计）
            void skillUsageTracker.bumpView(name);
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

  /**
   * P0-1（2026-09-02）：同会话同技能内容去重——首次/内容变化返回 null（正常返回全文），
   * 内容未变化返回 unchanged stub（提示模型直接执行，无需再次查看）。
   * 哈希按 (sessionId, skillName) 隔离，避免跨会话误判。
   */
  private checkUnchanged(
    sessionId: string | undefined,
    name: string,
    content: string
  ): ToolResult<unknown> | null {
    if (!sessionId) return null;
    const hash = hashCode(content);
    let perSession = VIEW_CACHE.get(sessionId);
    if (!perSession) {
      perSession = new Map();
      VIEW_CACHE.set(sessionId, perSession);
    }
    const prev = perSession.get(name);
    perSession.set(name, hash);
    if (prev === hash) {
      logger.info('skill_view 内容未变化，返回 unchanged stub', {
        skillName: name,
      });
      return {
        status: ToolExecutionStatus.SUCCESS,
        toolName: this.name,
        result: {
          name,
          source: 'unchanged',
          status: 'unchanged',
          content: '',
          message:
            '该技能已在本次会话中加载过且内容未变化，请直接按技能指引执行，无需再次调用 skill_view。',
        },
      };
    }
    return null;
  }
}
