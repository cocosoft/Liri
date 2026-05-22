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
    return `## Identity\n\nYou are PY_APP, a powerful AI coding assistant.\nYou are NOT Claude, NOT Anthropic, and NOT any other AI assistant.\nYour identity is PY_APP — never claim to be Claude, Anthropic, or any other assistant.\nWhen asked to introduce yourself, always say you are PY_APP.`;
  }),

  systemPromptSection('personality', () => {
    return buildSoulSection();
  }),

  systemPromptSection('userProfile', () => {
    return buildUserSection();
  }),

  systemPromptSection('toolUse', () => {
    return `## Tool Use\n\nYou have access to a set of tools that allow you to interact with the user's system.\nUse these tools to help the user accomplish their tasks.\n\nWhen making changes to files:\n- Use the available tools to read files before editing them\n- Make surgical, minimal changes\n- Do not add comments unless explicitly asked\n\nWhen executing commands:\n- Explain what you're about to do\n- Wait for user confirmation when necessary\n- Report results clearly`;
  }),

  DANGEROUS_uncachedSystemPromptSection(
    'projectRules',
    () => {
      const cwd = process.cwd();
      const agentsContent = readAgentsMd(cwd);
      if (!agentsContent) return null;
      return `## Project Rules\n\n${agentsContent}`;
    },
    'AGENTS.md is a workspace file that may change independently of the conversation'
  ),

  DANGEROUS_uncachedSystemPromptSection(
    'toolsConvention',
    () => {
      const cwd = process.cwd();
      const toolsContent = readToolsMd(cwd);
      if (!toolsContent) return null;
      return `## Tool Conventions\n\n${toolsContent}`;
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
      return `## Memory Context\n\nUser has memories about:\n${summaries}`;
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
