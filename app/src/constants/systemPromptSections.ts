/**
 * 系统提示词段落常量
 * 提供系统提示词段落的创建、解析和缓存管理
 */

import {
  buildSoulSection,
  clearSoulCache,
} from '@modules/services/soul/SoulReader';
import {
  buildUserSection,
  clearUserCache,
} from '@modules/services/soul/UserReader';
import {
  readAgentsMd,
  readToolsMd,
  clearWorkspaceCache,
} from '@modules/services/workspace';
import {
  getMemoryQueryProvider,
  getCurrentSessionContext,
} from '@modules/services/prompt/MemoryPromptProvider';
import {
  getKnowledgeQueryProvider,
  getCurrentKnowledgeQuery,
} from '@modules/services/prompt/KnowledgePromptProvider';
import { truncateMemoryContent } from '@modules/memory/MemoryTruncation';
import { getGitInfo } from '@modules/context/GitDetector';
import { readProjectFiles } from '@modules/context/ProjectFileReader';
import { basename, join } from 'path';
import { resolveProjectRoot } from '@modules/config/paths';
import { SkillInjectionService } from '@modules/skills/services/SkillInjectionService';

/** 技能注入服务单例 */
export const skillInjectionService = new SkillInjectionService({
  builtinSkillsDir: join(resolveProjectRoot(), 'app', 'src', 'builtin', 'skills'),
});

/**
 * 构建上下文隔离的记忆块
 * 包裹 <memory-context> 标签，防止记忆被误认为用户输入
 */
export function buildMemoryContextBlock(memoryContent: string): string {
  return [
    '<memory-context>',
    '[System note: The following is recalled memory, NOT new user input.]',
    memoryContent,
    '</memory-context>',
  ].join('\n');
}

/**
 * 计算函数类型
 */
type ComputeFn = () => string | null | Promise<string | null>;

/**
 * 系统提示词段落定义
 */
export type SystemPromptSection = {
  name: string;
  compute: ComputeFn;
  cacheBreak: boolean;
};

/**
 * 段落缓存
 * 在/clear或/compact时清除
 */
const sectionCache = new Map<string, string | null>();

/**
 * 已注册的段落列表
 */
let registeredSections: SystemPromptSection[] = [];

/** 缓存边界标记 — 分隔稳定段落与动态段落 */
export const CACHE_BOUNDARY = '<!-- CACHE_BOUNDARY -->';

/**
 * 创建缓存的系统提示词段落
 * 计算一次后缓存，直到/clear或/compact时清除
 */
export function systemPromptSection(
  name: string,
  compute: ComputeFn
): SystemPromptSection {
  return { name, compute, cacheBreak: false };
}

/**
 * 创建易变的系统提示词段落
 * 每轮重新计算，值变化时会破坏提示缓存
 * 需要提供原因说明为何需要破坏缓存
 */
export function DANGEROUS_uncachedSystemPromptSection(
  name: string,
  compute: ComputeFn,
  _reason: string
): SystemPromptSection {
  return { name, compute, cacheBreak: true };
}

/** 默认注册的所有段落 */
const DEFAULT_SECTIONS: SystemPromptSection[] = [
  systemPromptSection('identity', () => {
    return `## 身份\n\n你是 PY_APP，一个强大的AI私人助手。\n你不是Claude，不是Anthropic，也不是任何其他AI助手。\n你的身份是 PY_APP——绝不自称为Claude、Anthropic或任何其他助手。\n当被要求自我介绍时，始终回答你是 PY_APP。`;
  }),

  DANGEROUS_uncachedSystemPromptSection(
    'projectRules',
    () => {
      const cwd = resolveProjectRoot();
      const agentsContent = readAgentsMd(cwd);
      if (!agentsContent) return null;
      return `## 项目规则\n\n${agentsContent}`;
    },
    'AGENTS.md is a workspace file that may change independently of the conversation'
  ),

  DANGEROUS_uncachedSystemPromptSection(
    'toolsConvention',
    () => {
      const cwd = resolveProjectRoot();
      const toolsContent = readToolsMd(cwd);
      if (!toolsContent) return null;
      return `## 工具约定\n\n${toolsContent}`;
    },
    'TOOLS.md is a workspace file that may change independently of the conversation'
  ),

  systemPromptSection('toolUse', () => {
    return `## 工具使用\n\n你可以使用一系列工具与用户的系统进行交互。\n使用这些工具帮助用户完成任务。\n\n修改文件时：\n- 使用可用工具先读取文件再编辑\n- 做精准、最小化的修改\n- 除非明确要求，否则不添加注释\n\n执行命令时：\n- 先说明你要做什么\n- 必要时等待用户确认\n- 清晰地报告结果`;
  }),

  systemPromptSection('userProfile', () => {
    return buildUserSection();
  }),

  systemPromptSection('personality', () => {
    return buildSoulSection();
  }),

  DANGEROUS_uncachedSystemPromptSection(
    'memoryContext',
    async () => {
      const provider = getMemoryQueryProvider();
      if (!provider) return null;

      const result = await provider.getMemorySummaries(5);
      if (result.summaries.length === 0) return null;

      const summaries = result.summaries
        .map((s, i) => `${i + 1}. ${s}`)
        .join('\n');

      const truncated = truncateMemoryContent(summaries);
      const memoryBlock = buildMemoryContextBlock(
        `## 记忆上下文\n\n用户有以下相关记忆：\n${truncated.content}`
      );
      return memoryBlock;
    },
    'Memory summaries change as new memories are created'
  ),

  DANGEROUS_uncachedSystemPromptSection(
    'gitContext',
    async () => {
      const gitInfo = await getGitInfo(resolveProjectRoot());
      if (!gitInfo.isGit) return null;
      const parts: string[] = ['## Git 上下文'];
      if (gitInfo.branch) {
        parts.push(`当前分支: ${gitInfo.branch}`);
      }
      if (gitInfo.status) {
        parts.push(`\n状态:\n${gitInfo.status}`);
      }
      return parts.join('\n');
    },
    'Git status changes as files are modified'
  ),

  DANGEROUS_uncachedSystemPromptSection(
    'projectMeta',
    async () => {
      const cwd = resolveProjectRoot();
      const projectFiles = readProjectFiles(cwd);
      const projectName = basename(cwd);
      const parts: string[] = [`## 项目信息\n\n项目名称: ${projectName}`];
      if (projectFiles.pyAppMd) {
        parts.push(`## 项目规则\n\n${projectFiles.pyAppMd}`);
      }
      if (projectFiles.readme) {
        parts.push(`## README\n\n${projectFiles.readme}`);
      }
      return parts.join('\n\n');
    },
    'Project files may change independently of conversation'
  ),

  DANGEROUS_uncachedSystemPromptSection(
    'skills',
    async () => {
      await skillInjectionService.ensureFresh();
      return skillInjectionService.getInjectionPrompt() || null;
    },
    'Skill injection content changes as conditions update'
  ),

  DANGEROUS_uncachedSystemPromptSection(
    'sessionContext',
    () => {
      const ctx = getCurrentSessionContext();
      if (!ctx || ctx.turnCount <= 1) return null;
      const durationMinutes = Math.round(ctx.duration / 60000);
      const parts: string[] = ['## 会话上下文'];
      parts.push(`当前会话已进行 ${ctx.turnCount} 轮`);
      if (durationMinutes > 0) {
        parts.push(`持续 ${durationMinutes} 分钟`);
      }
      if (ctx.tags?.length) {
        parts.push(`标签: ${ctx.tags.join(', ')}`);
      }
      if (ctx.recentTopics?.length) {
        parts.push(`近期主题: ${ctx.recentTopics.join(', ')}`);
      }
      return parts.join('\n');
    },
    'Session state changes every turn'
  ),

  DANGEROUS_uncachedSystemPromptSection(
    'knowledgeContext',
    async () => {
      const provider = getKnowledgeQueryProvider();
      if (!provider) return null;

      const query = getCurrentKnowledgeQuery();
      if (!query) return null;

      const result = await provider.getKnowledgeSummaries(query, 3);
      if (result.summaries.length === 0) return null;

      const parts: string[] = ['## 相关知识'];
      for (const s of result.summaries) {
        parts.push(`\n### ${s.title}`);
        parts.push(s.content);
      }
      return parts.join('\n');
    },
    'Knowledge relevance depends on current conversation context'
  ),
];

/**
 * 注册系统提示词段落
 */
export function registerSections(sections: SystemPromptSection[]): void {
  registeredSections = sections;
}

/**
 * 获取当前注册的段落列表
 */
export function getRegisteredSections(): SystemPromptSection[] {
  return registeredSections.length > 0 ? registeredSections : DEFAULT_SECTIONS;
}

/**
 * 重置为默认段落
 */
export function resetToDefaultSections(): void {
  registeredSections = [];
  sectionCache.clear();
}

/**
 * 解析所有系统提示词段落，返回提示词字符串数组
 */
export async function resolveSystemPromptSections(
  sections?: SystemPromptSection[]
): Promise<(string | null)[]> {
  const targetSections = sections ?? getRegisteredSections();
  return Promise.all(
    targetSections.map(async (s) => {
      if (!s.cacheBreak && sectionCache.has(s.name)) {
        return sectionCache.get(s.name) ?? null;
      }
      const value = await s.compute();
      sectionCache.set(s.name, value);
      return value;
    })
  );
}

/**
 * 清除所有系统提示词段落缓存
 * 在/clear和/compact时调用
 */
export function clearSystemPromptSections(): void {
  sectionCache.clear();
  clearSoulCache();
  clearUserCache();
  clearWorkspaceCache();
}
