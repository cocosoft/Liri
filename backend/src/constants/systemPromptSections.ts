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
import { getMemoryQueryProvider } from '@modules/services/prompt/MemoryPromptProvider';

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
    return `## 身份\n\n你是 PY_APP，一个强大的AI编程助手。\n你不是Claude，不是Anthropic，也不是任何其他AI助手。\n你的身份是 PY_APP——绝不自称为Claude、Anthropic或任何其他助手。\n当被要求自我介绍时，始终回答你是 PY_APP。`;
  }),

  systemPromptSection('personality', () => {
    return buildSoulSection();
  }),

  systemPromptSection('userProfile', () => {
    return buildUserSection();
  }),

  systemPromptSection('toolUse', () => {
    return `## 工具使用\n\n你可以使用一系列工具与用户的系统进行交互。\n使用这些工具帮助用户完成任务。\n\n修改文件时：\n- 使用可用工具先读取文件再编辑\n- 做精准、最小化的修改\n- 除非明确要求，否则不添加注释\n\n执行命令时：\n- 先说明你要做什么\n- 必要时等待用户确认\n- 清晰地报告结果`;
  }),

  DANGEROUS_uncachedSystemPromptSection(
    'projectRules',
    () => {
      const cwd = process.cwd();
      const agentsContent = readAgentsMd(cwd);
      if (!agentsContent) return null;
      return `## 项目规则\n\n${agentsContent}`;
    },
    'AGENTS.md is a workspace file that may change independently of the conversation'
  ),

  DANGEROUS_uncachedSystemPromptSection(
    'toolsConvention',
    () => {
      const cwd = process.cwd();
      const toolsContent = readToolsMd(cwd);
      if (!toolsContent) return null;
      return `## 工具约定\n\n${toolsContent}`;
    },
    'TOOLS.md is a workspace file that may change independently of the conversation'
  ),

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
      return `## 记忆上下文\n\n用户有以下相关记忆：\n${summaries}`;
    },
    'Memory summaries change as new memories are created'
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
