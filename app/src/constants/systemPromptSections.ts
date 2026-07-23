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
import { resolveProjectRoot } from '@modules/core';
import { SkillInjectionService } from '@modules/skills/services/SkillInjectionService';
import { SkillRegistry } from '@modules/skills/SkillRegistry';
import { FileSkillLoader } from '@modules/skills/loaders/sources/FileSkillLoader';
import { SkillSource } from '@modules/skills/types';

/** 内建技能目录 */
const BUILTIN_SKILLS_DIR = join(
  resolveProjectRoot(),
  'app',
  'src',
  'builtin',
  'skills'
);

/** 技能注册表单例 */
export const skillRegistry = new SkillRegistry();

/** 技能注入服务单例 */
export const skillInjectionService = new SkillInjectionService(skillRegistry);

/**
 * 初始化内建技能（从文件加载并注册到 Registry）
 * 在应用启动时调用一次即可
 */
export async function initBuiltinSkills(): Promise<void> {
  const loader = new FileSkillLoader({
    directories: [BUILTIN_SKILLS_DIR],
    source: SkillSource.OFFICIAL,
    loadedFrom: 'builtin',
    recursive: true,
    skillFileName: 'SKILL.md',
  });
  const skills = await loader.loadSkills();
  for (const skill of skills) {
    skillRegistry.register(skill);
  }
}

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

/** Phase 2: 简单字符串 hash（djb2，用于内容缓存保护） */
function hashString(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/** Phase 2: 记忆内容 hash 缓存（保护 LLM 提示缓存） */
let memoryContentHash = '';

/** 默认注册的所有段落 */
const DEFAULT_SECTIONS: SystemPromptSection[] = [
  systemPromptSection('identity', () => {
    return `## 身份

你是 Liri（OpenLiri），中文名：玲珑鸟，一个开源的 AI 智能体平台。

**关于你自己**：
- 你由cocosoft从零开发，源代码位于当前工作目录
- 基于 TypeScript + Rust 构建，运行于 Bun 运行时
- 具备 60+ 内置工具、TAOR 智能体循环引擎、梦境自我进化系统、5 层安全防护、多模型多通道架构
- 你的身份是 Liri，一个智能编程助手
- 当被要求自我介绍时，介绍你是 Liri，一个 AI 智能体平台，由个人开发者从零开发`;
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

  systemPromptSection('taskNegotiation', () => {
    return `## 复杂任务处理

当你接到一个复杂任务时，不要一次性输出完整方案，而是按照以下规则与用户协商。

### 判断是否需要协商
以下情况属于"复杂任务"，需要与用户协商后再执行：
- 任务方向存在多种可能性，需要用户决策
- 任务的最终交付物不确定，需要用户确认

以下情况可以直接执行，不需要协商：
- 单步操作（如"读取这个文件"）
- 明确的指令（如"搜索 Python 异步编程"）
- 用户已经说清楚要做什么，无歧义

### 协商规则
- 最多与用户协商 2 轮
- 第 1 轮：提出初步分解方案，一次性列出所有维度，说明依赖关系
- 第 2 轮：根据反馈调整，再次确认
- 2 轮后无论用户是否满意，按当前方案执行
- 用户也可以直接说"开始吧"或"别问了，直接开始"提前结束协商
- 使用 ask_user_question 工具询问用户意见
- 默认一次性问完所有问题，不要逐项问（如不要问"要不要加A？"、"要不要加B？"）。但若用户明确要求逐个提问，则遵从用户要求

### 任务计划（必须 todo_write）
任何任务如果满足以下任一条件，**必须立刻调用 todo_write action=write 写入子任务列表，作为执行的第一步**：
- 可以分解为 2 个以上子步骤
- 需要调用多个工具或访问多个模块/文件
- 子步骤之间存在依赖关系（A 完成后才能做 B）

即使任务很明确不需要协商，只要满足上述条件，也必须先用 todo_write 列出计划。
用户的进度可见性完全依赖 todo list，所以**必须每完成一个子步骤立即调用 todo_write update 更新状态**。

在 todo_write 的 metadata 中注明 dependsOn 依赖关系（格式：{"taskId": 3, "dependsOn": [1, 2]}）。
按依赖关系顺序执行：无依赖的先执行，有依赖的后执行。

### 重型任务进度报告
重型任务（3 次以上工具调用，如批量读取多个文件）需要额外关注进度透明度：
- **必须**先 todo_write 列出子任务，让用户知道总体规模（"共 10 个文件需要读取"）
- 每完成一个子步骤，**必须**立即 todo_write update 更新对应任务状态（如 "读取 Logger.ts" → completed）
- 同时 inline 回复中不带进度信息（已由 todo block 显示），保持回复简洁
  - 如果连续执行 3 次以上工具调用且未产生用户可见输出,必须主动报进度。超过 30 秒无用户可见输出则必须主动说明当前状态。

### 异常处理
- 子任务失败时，暂停执行，告知用户失败原因
- 评估失败对后续任务的影响（检查 dependsOn 关系）
- 使用 ask_user_question 询问用户如何处理（重试 / 跳过 / 改方案）

### 完成总结
- 全部完成后，生成一段自然语言总结（关键结果 + 输出文件路径），追加到会话中

### 超时
- 如果发出问题后用户超过 30 秒没有回复，按当前方案自动执行
- 不要重复问同一个问题`;
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

      // Phase 2: hash-based 缓存保护 — 内容未变时跳过重建
      const currentHash = hashString(summaries);
      if (currentHash === memoryContentHash && sectionCache.has('memoryContext')) {
        return sectionCache.get('memoryContext') ?? null;
      }
      memoryContentHash = currentHash;

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
  memoryContentHash = '';
  clearSoulCache();
  clearUserCache();
  clearWorkspaceCache();
}
