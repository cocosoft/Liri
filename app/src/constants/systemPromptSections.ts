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
import { getFrozenSnapshotService } from '@modules/memory';
import {
  getKnowledgeQueryProvider,
  getCurrentKnowledgeQuery,
} from '@modules/services/prompt/KnowledgePromptProvider';
import { generateDigestContext } from '@modules/knowledge/KnowledgeDigestInjector';
import { truncateMemoryContent } from '@modules/memory';
import { getGitInfo } from '@modules/context';
import { readProjectFiles } from '@modules/context';
import { basename, join } from 'path';
import { resolveProjectRoot } from '@modules/core';
import { resolveDataDir, resolveKnowledgeDir } from '@modules/core/paths';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { createProjectStore } from '../workspace/ProjectStore.js';
import { WorkItemStore } from '../workspace/WorkItemStore.js';
import { SkillInjectionService } from '@modules/skills/services/SkillInjectionService';
import { SkillRegistry } from '@modules/skills/SkillRegistry';
import { getSkillHub } from '@modules/skills/SkillHub';
import { loadBuiltinEnabled } from '@modules/skills/BuiltinEnabledStore';
import { BUILTIN_EXAMPLES, renderFewShotPrompt } from '@modules/tools';
import {
  getPunctuationHint,
  resolveLanguage,
} from '@modules/system/i18n/languageProfiles';

// 技能注册表/注入服务单例 —— 惰性 Proxy（2026-08-30，T7 单测 TDZ 根因修复）：
// 原 `new SkillRegistry()` / `new SkillInjectionService()` 在模块顶层立即执行，
// bun test worker 的依赖图加载序（skills → … → systemPromptSections → skills）
// 触发 `Cannot access 'SkillRegistry' before initialization`（生产 main.ts 启动序正常，
// 仅 bun test 加载序触发）。对齐 aiService.ts 惰性 Proxy 模式：首次访问成员才实例化，
// 消费方用法不变。实测 loopGuard/aiService 同模式已验证可用。
let _skillRegistry: SkillRegistry | undefined;
export const skillRegistry = new Proxy({} as SkillRegistry, {
  get(_target, prop: keyof SkillRegistry, receiver) {
    _skillRegistry ??= new SkillRegistry();
    const value = Reflect.get(_skillRegistry, prop, _skillRegistry);
    return typeof value === 'function' ? value.bind(_skillRegistry) : value;
  },
});

let _skillInjectionService: SkillInjectionService | undefined;
export const skillInjectionService = new Proxy({} as SkillInjectionService, {
  get(_target, prop: keyof SkillInjectionService, receiver) {
    _skillInjectionService ??= new SkillInjectionService(skillRegistry);
    const value = Reflect.get(
      _skillInjectionService,
      prop,
      _skillInjectionService
    );
    return typeof value === 'function'
      ? value.bind(_skillInjectionService)
      : value;
  },
});

// P1-2: 模块级单例，避免每次组装 prompt 都 new ProjectStore/WorkItemStore
// （与 WriteProjectFileTool 的 P4-1 单例模式一致；若 dataDir 运行时变化需重新初始化）
let _promptWorkItemStore: WorkItemStore | null = null;
let _promptProjectStore: ReturnType<typeof createProjectStore> | null = null;
function getPromptProjectStore() {
  if (!_promptWorkItemStore || !_promptProjectStore) {
    const dataDir = resolveDataDir();
    _promptWorkItemStore = new WorkItemStore(dataDir);
    _promptProjectStore = createProjectStore(dataDir, _promptWorkItemStore);
  }
  return _promptProjectStore;
}

/**
 * 初始化内建技能（BundledSkillLoader 程序化定义 → SkillRegistry 注册）
 * 在应用启动时调用一次即可
 * 2026-08-06：原 FileSkillLoader 扫描 app/src/builtin/skills/（目录不存在，加载 0 个）；
 * 改为 BundledSkillLoader（10 个内置技能定义），修复内置技能未注册/前端不显示。
 * 2026-08-06 fix：同时加载用户技能目录（~/.pyapp/skills/ 下 SKILL.md），
 * 否则用户新建技能从不进入运行时 registry，SkillTool/注入均无法感知。
 */
export async function initBuiltinSkills(): Promise<void> {
  const { BundledSkillLoader } =
    await import('@modules/skills/loaders/sources/BundledSkillLoader');
  const { FileSkillLoader } =
    await import('@modules/skills/loaders/sources/FileSkillLoader');
  const { SkillSource } = await import('@modules/skills/types');
  const { resolveUserSkillsDir } = await import('@modules/core/paths');
  const loader = new BundledSkillLoader();
  const userLoader = new FileSkillLoader({
    directories: [resolveUserSkillsDir()],
    source: SkillSource.THIRD_PARTY,
    loadedFrom: 'user',
  });
  const [skills, userSkills] = await Promise.all([
    loader.loadSkills(),
    userLoader.loadSkills(),
  ]);
  // 3.5.7：恢复内置技能禁用状态（持久化 builtin-enabled.json），避免重启后复活
  const builtinEnabled = loadBuiltinEnabled();
  const allSkills = [...skills, ...userSkills];
  for (const skill of allSkills) {
    if (skillRegistry.has(skill.name, { includeDisabled: true })) continue;
    skillRegistry.register(skill);
    if (builtinEnabled.has(skill.name)) {
      skillRegistry.setEnabled(skill.name, builtinEnabled.get(skill.name)!);
    }
  }
  // v1.5：绑定 SkillHub 只读投影（幂等），后续 setEnabled 经 skill-updated 事件自动刷新
  getSkillHub().bindTo(skillRegistry);
}

/**
 * 重载用户技能目录（~/.pyapp/skills/）到运行时 registry。
 * 2026-08-06：用户通过技能创建/导入写盘 SKILL.md 后调用，使新增技能立即可被
 * SkillTool 同步与 SkillInjectionService 注入感知，无需重启。
 */
export async function reloadUserSkills(): Promise<void> {
  const { FileSkillLoader } =
    await import('@modules/skills/loaders/sources/FileSkillLoader');
  const { SkillSource } = await import('@modules/skills/types');
  const { resolveUserSkillsDir } = await import('@modules/core/paths');
  const { join } = await import('path');
  const { existsSync, readFileSync } = await import('fs');
  const dir = resolveUserSkillsDir();
  const loader = new FileSkillLoader({
    directories: [dir],
    source: SkillSource.THIRD_PARTY,
    loadedFrom: 'user',
  });
  const skills = await loader.loadSkills();
  // 磁盘上已删除的用户技能 → 从 registry 移除（覆盖删除场景）
  const onDisk = new Set(skills.map((s) => s.name));
  for (const existing of skillRegistry.getAll({ includeDisabled: true })) {
    if (existing.loadedFrom === 'user' && !onDisk.has(existing.name)) {
      skillRegistry.unregister(existing.name);
    }
  }
  // 新增用户技能 → 注册（含 .enabled 审批标记）
  let added = 0;
  for (const skill of skills) {
    if (skillRegistry.has(skill.name, { includeDisabled: true })) continue;
    skillRegistry.register(skill);
    added++;
    // 导入审批：敏感权限技能 .enabled 标记为 false → 注册为禁用（含权限审批技能）
    const enabledFile = join(dir, skill.name, '.enabled');
    if (
      existsSync(enabledFile) &&
      readFileSync(enabledFile, 'utf-8').trim() === 'false'
    ) {
      skillRegistry.setEnabled(skill.name, false);
    }
  }
  if (added > 0) {
    getSkillHub().bindTo(skillRegistry);
    // refreshAll 内部会 clear L1 缓存并重读 registry，使注入服务感知新技能
    await skillInjectionService.refreshAll();
  }
  return;
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
- 具备动态启用的内置工具集（数量随启动变体与运行时注册而定，不写死）、TAOR 智能体循环引擎、梦境自我进化系统、5 层安全防护、多模型多通道架构
- 你的身份是 Liri，一个智能编程助手
- 当被要求自我介绍时，介绍你是 Liri，一个 AI 智能体平台`;
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
    return `## 工具使用\n\n你可以使用一系列工具与用户的系统进行交互。\n使用这些工具帮助用户完成任务。\n\n修改文件时：\n- 使用可用工具先读取文件再编辑\n- 做精准、最小化的修改\n- 除非明确要求，否则不添加注释\n\n执行命令时：\n- 先说明你要做什么\n- 必要时等待用户确认\n- 清晰地报告结果\n\n## 输出规范\n\n推理、探索、工具使用的过程叙述（如"让我先查看…""我定位到…""继续读文件…""命令被拦截，改用…"等）只允许放在思考通道（thinking）或 <think>...</think> 标签内，正文只输出对用户问题的最终回答。禁止把工具执行过程叙述混入正文。`;
  }),

  systemPromptSection('toolIntegrity', () => {
    return `## 工具结果完整性铁律

**工具是你与现实世界之间的唯一桥梁。桥断了（返回空），你不能画一座假桥。**

### 规则 1：空结果禁止编造
- 文件读取工具返回空 → 报告"文件不存在或为空：[路径]"，**禁止编造文件内容**
- 文件搜索工具返回空 → 报告"未找到匹配 [pattern] 的文件"，**禁止虚构文件列表**
- 内容搜索工具返回空 → 报告"未搜索到 [关键词]"，**禁止编造匹配行**
- 目录列表返回空 → 报告"目录为空或不存在：[路径]"，**禁止虚构目录结构**

### 规则 2：错误必须停止
- 工具返回错误（权限拒绝、非预期错误码等）→ 停止当前分析链路
- 向用户报告具体错误，提出替代方案
- 禁止忽略错误继续执行，禁止用"可能"、"假设"开头的推测替代错误报告

### 规则 3：路径解析最多 2 次重试
- 文件路径解析失败时，最多重试 2 次
- 第 1 次：用已知的正确路径重试
- 第 2 次：检查是否有路径映射错误
- 2 次都失败 → 停止猜测，向用户确认正确路径
- **禁止**连续尝试 4+ 个不同路径（这是路径赌博，不是路径解析）

### 规则 4：证据驱动分析
- 下结论前必须用工具验证
- 每个结论标注来源（文件路径 + 行号）
- "没找到" ≠ "不存在"：搜索确认后才能下结论
- 分析输出中的每一句话，都必须来自工具返回的真实数据，不能来自推测

### 规则 5：工具失败不能静默终止
- 任何工具返回错误或空结果时，**禁止直接结束对话**
- 必须向用户明确报告：哪个工具、什么错误、用户可以做什么
- 长程任务中单个工具失败 ≠ 整个任务失败。应询问用户是否跳过该步骤继续
- 系统会在你无工具调用时自动检查上一轮是否有工具错误。如果你收到"[系统提示] 上一轮工具调用返回了错误或空结果"，请先回复该提示，不要忽略它

### 自查问句
在你输出分析结论之前，问自己：
1. 这个结论有工具返回的真实数据支撑吗？
2. 有没有任何一句话是我编造的？
3. 如果某个工具返回了空，我有没有如实报告？`;
  }),

  systemPromptSection('shellDeclaration', () => {
    return `## Shell 文件操作声明\n\n在执行 Shell/PowerShell 命令之前，如果该命令会创建、修改或删除文件，请先在回复中用以下格式声明：\n\n\`\`\`declaration\n[FILE_OPERATION] <create|modify|delete> <文件路径>\n\`\`\`\n\n示例：\n\`\`\`declaration\n[FILE_OPERATION] create src/utils.ts\n[FILE_OPERATION] modify package.json\n\`\`\`\n\n此声明仅用于追踪文件变更，不影响命令执行。`;
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
- 子任务失败时，**必须**立即告知用户失败原因，不得静默跳过
- **工具返回错误或空结果时，禁止直接结束对话**。必须向用户报告：
  - 哪个工具失败了
  - 失败的具体原因（错误信息或空结果）
  - 用户可以采取什么行动（如：确认文件路径、提供更多信息、换一种方式）
- 评估失败对后续任务的影响（检查 dependsOn 关系）
- 使用 ask_user_question 询问用户如何处理（重试 / 跳过 / 改方案）
- **核心原则**：遇到问题时，用户应该感受到的是一个求助的助手，而不是一个沉默放弃的机器人

### 完成总结
- 全部完成后，生成一段自然语言总结（关键结果 + 输出文件路径），追加到会话中

### 项目创建（工具优先）
当用户表达明确的"创建项目/管理任务/追踪进度"意图时：
- 有 create_project 工具可用时：**直接调用工具创建项目**，不要只建议用户手动操作
- 仅当没有工具可用时：引导用户在左侧点击"+"创建（每个会话最多建议一次）

示例：用户说"帮我建一个XX项目" → 直接调用 create_project 工具，参数 name="XX"。`;
  }),

  systemPromptSection('pdcaThinking', () => {
    return `## 内部思维框架（不对外提及）

回复用户时，在内部遵循以下思维过程，但**绝对不要在输出中提及这些术语**：

- **明确目标**：用户到底想达成什么？如果目标不明确，先通过提问澄清。
- **产出结果**：基于目标给出完整的、可直接使用的产出（代码/方案/分析）。
- **自查质量**：产出后对照目标检查：是否完整？有无遗漏边界情况？结果是否可用？
- **主动改进**：发现差距时主动提出补充建议，而不是等用户发现问题。

用户只应该感受到一个"考虑周全"的助手，不需要知道 Plan/Do/Check/Act 的存在。`;
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
      // P1-2: 冻结快照优先 — 会话内记忆不变，避免每轮重算破坏 Prompt 缓存
      const ctx = getCurrentSessionContext();
      if (ctx) {
        const frozenService = getFrozenSnapshotService();
        const frozen = frozenService.getFrozen(ctx.sessionId);
        if (frozen) return frozen;
      }

      const provider = getMemoryQueryProvider();
      if (!provider) return null;

      const result = await provider.getMemorySummaries(10);
      if (result.summaries.length === 0) return null;

      const summaries = result.summaries
        .map((s, i) => `${i + 1}. ${s}`)
        .join('\n');

      // Phase 2: hash-based 缓存保护 — 内容未变时跳过重建
      const currentHash = hashString(summaries);
      if (
        currentHash === memoryContentHash &&
        sectionCache.has('memoryContext')
      ) {
        return sectionCache.get('memoryContext') ?? null;
      }
      memoryContentHash = currentHash;

      const truncated = truncateMemoryContent(summaries);
      const memoryBlock = buildMemoryContextBlock(
        `## 记忆上下文\n\n用户有以下相关记忆：\n${truncated.content}`
      );

      // P1-2: 首次计算后冻结，会话内不再重算
      if (ctx && memoryBlock) {
        getFrozenSnapshotService().freeze(ctx.sessionId, memoryBlock);
      }

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
      // P1-3: Skills 改为 User Message 注入（SkillInjectionService.injectSkillsIntoMessageHistory），
      // 不再注入到 System Prompt，避免破坏 cache_control 前缀。
      return null;
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
    'projectContext',
    () => {
      const ctx = getCurrentSessionContext();
      if (!ctx?.projectId) return null;

      const contextPath = join(
        resolveDataDir(),
        'projects',
        ctx.projectId,
        'project-context.md'
      );
      if (!existsSync(contextPath)) return null;

      try {
        const content = readFileSync(contextPath, 'utf-8').trim();
        if (!content) return null;

        // 提取 sandboxPath
        const sandboxMatch = content.match(/\*\*文件夹\*\*:\s*(.+)/);
        const sandboxPath = sandboxMatch?.[1]?.trim();

        // S5b: 查询项目阶段与进度（来自 ProjectStore）
        let phaseInfo = '';
        try {
          // P1-2: 复用模块级单例，避免每次组装都 new store + require
          const store = getPromptProjectStore();
          const project = store.get(ctx.projectId);
          if (project) {
            const phaseLabel: Record<string, string> = {
              plan: '规划中',
              do: '执行中',
              check: '审查中',
              act: '反馈中',
              active: '活跃',
              completed: '已完成',
            };
            const pdcaCount = project.pdcaIds?.length ?? 0;
            const workItemCount = project.workItemIds?.length ?? 0;
            const lines: string[] = [];
            lines.push(
              `**阶段**: ${phaseLabel[project.phase ?? 'active'] ?? project.phase ?? '活跃'}`
            );
            if (pdcaCount > 0) lines.push(`**PDCA 任务**: ${pdcaCount} 个`);
            if (workItemCount > 0)
              lines.push(`**工作项**: ${workItemCount} 个`);
            if (project.status === 'completed') lines.push('**状态**: 已完成');
            if (lines.length > 0) {
              phaseInfo = '\n\n## 项目状态\n\n' + lines.join('\n');
            }
          }
        } catch {
          // @ignore-catch ProjectStore 查询失败不影响 prompt 组装主流程
        }

        // P3-5: 附加最近摘要（最近 1 条阶段性小结 + 2 条决策）
        // 注：本 section 为同步构建（DANGEROUS_uncached），无法 await items.db；
        // 已迁移项目的摘要经 handleGetSummaries（HTTP 读回退 items.db）与
        // SessionSummarizer（写分流进 items.db）保障可见，此处仅同步读 summaries.json。
        let summaryInfo = '';
        try {
          const summariesPath = join(
            resolveDataDir(),
            'projects',
            ctx.projectId,
            'summaries.json'
          );
          let all: Array<{
            type?: string;
            title?: string;
            content?: string;
          }> = [];
          if (existsSync(summariesPath)) {
            const raw = readFileSync(summariesPath, 'utf-8');
            // G-2 修复：兼容写入者结构。SessionSummarizer 写的是 SummaryEntry
            // （{sessionId, summary, messageCount, createdAt, decision?, phaseSummary?}，
            // 无 type 字段），原实现按 s.type==='decision'/'phase_summary' 过滤恒空 →
            // AI 上下文永远看不到项目最近小结/决策。此处归一化为 {type,title,content}。
            const rawEntries = JSON.parse(raw) as Array<
              Record<string, unknown>
            >;
            all = rawEntries
              .map((s) => {
                if (s.decision) {
                  return {
                    type: 'decision',
                    title: '决策',
                    content: String(s.decision),
                  };
                }
                if (s.phaseSummary) {
                  return {
                    type: 'phase_summary',
                    title: '阶段性小结',
                    content: String(s.summary ?? ''),
                  };
                }
                if (typeof s.type === 'string') {
                  return {
                    type: s.type,
                    title: String(s.title ?? ''),
                    content: String(s.content ?? ''),
                  };
                }
                return null;
              })
              .filter(
                (x): x is { type: string; title: string; content: string } =>
                  x !== null
              );
          }
          const decisions = all.filter((s) => s.type === 'decision').slice(-2);
          const phaseSummaries = all
            .filter((s) => s.type === 'phase_summary')
            .slice(-1);

          const lines: string[] = [];
          if (phaseSummaries.length > 0) {
            lines.push('## 最近阶段性小结');
            for (const s of phaseSummaries) {
              lines.push(
                `- ${s.title ?? '小结'}: ${(s.content ?? '').slice(0, 150)}`
              );
            }
          }
          if (decisions.length > 0) {
            lines.push('## 最近决策');
            for (const d of decisions) {
              lines.push(
                `- ${d.title ?? '决策'}: ${(d.content ?? '').slice(0, 100)}`
              );
            }
          }
          if (lines.length > 0) {
            summaryInfo = '\n\n' + lines.join('\n');
          }
        } catch {
          // @ignore-catch 读取摘要失败不影响 prompt 组装主流程
        }

        // 扫描文件列表
        let fileList = '';
        if (sandboxPath && existsSync(sandboxPath)) {
          try {
            const entries = readdirSync(sandboxPath, { withFileTypes: true });
            const MAX_FILES = 20;
            const files = entries.filter((e) => e.isFile()).slice(0, MAX_FILES);
            const dirs = entries
              .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
              .slice(0, 5);

            if (files.length > 0 || dirs.length > 0) {
              const lines: string[] = ['**项目文件**：'];
              for (const d of dirs) {
                lines.push(`- ${d.name}/`);
              }
              for (const f of files) {
                try {
                  const size = statSync(join(sandboxPath, f.name)).size;
                  const sizeStr =
                    size < 1024
                      ? `${size}B`
                      : size < 1024 * 1024
                        ? `${(size / 1024).toFixed(0)}KB`
                        : `${(size / (1024 * 1024)).toFixed(1)}MB`;
                  lines.push(`- ${f.name} (${sizeStr})`);
                } catch {
                  // @ignore-catch 单个文件 stat 失败仅回退无大小展示
                  lines.push(`- ${f.name}`);
                }
              }
              if (entries.filter((e) => e.isFile()).length > MAX_FILES) {
                lines.push(
                  `(+${entries.filter((e) => e.isFile()).length - MAX_FILES} 个文件未列出)`
                );
              }
              fileList = '\n' + lines.join('\n');
            }
          } catch {
            // @ignore-catch 目录扫描失败不影响 prompt 组装主流程
          }
        }

        // 当前文档语言（方案 v4 §六：通用设置 → 系统语言 → 内容检测）
        const docLang = resolveLanguage(undefined, '');

        const toolGuidance = [
          '## 项目上下文',
          '',
          content,
          phaseInfo,
          summaryInfo,
          fileList,
          '',
          '**文件组织约定**（必须遵守）：',
          '- `00_input/` — 用户提供的输入材料（原始文档/附件），不要写入生成内容',
          '- `01_work/` — 过程脚本与临时文件（如 `_*.py`、`_temp_*`），过程产物放这里',
          '- `output/` — 最终交付物（docx/pptx/pdf/html/md/架构图等），交付文件放这里',
          '- 禁止把脚本、临时文件直接散落在项目根目录',
          '- 交付文件生成后请用 `write_project_file` 写入 `output/`（会自动登记到「成果」）',
          '- 会话结束前请清理 `01_work/` 下的临时文件',
          '',
          '**文档语言与标点**（生成文档/报告内容时遵守）：',
          `- 当前文档语言：${docLang}；请使用${getPunctuationHint(docLang)} 等对应语言标点风格`,
          '',
          '**可用工具**：',
          '- `read_project_file` — 读取项目文件夹中的文件（传入 projectId + relativePath）',
          '- `write_project_file` — 向项目文件夹写入文件（传入 projectId + relativePath + content）',
          '- 以上工具已做路径安全校验，仅允许在项目文件夹范围内读写',
          `- 当前项目 ID: \`${ctx.projectId}\``,
        ].join('\n');

        // P3-8: 上下文总量字符上限 4000，防止大项目 prompt 膨胀
        const MAX_CONTEXT_CHARS = 4000;
        const footer = [
          '',
          '**可用工具**：',
          '- `read_project_file` — 读取项目文件夹中的文件',
          '- `write_project_file` — 向项目文件夹写入文件',
          `- 当前项目 ID: \`${ctx.projectId}\``,
        ].join('\n');

        if (toolGuidance.length > MAX_CONTEXT_CHARS) {
          const bodyEnd = toolGuidance.lastIndexOf(footer.trim());
          const body =
            bodyEnd > 0 ? toolGuidance.slice(0, bodyEnd) : toolGuidance;
          const maxBody = MAX_CONTEXT_CHARS - footer.length - 50;
          return (
            (body.length > maxBody
              ? body.slice(0, maxBody) + '\n\n*(上下文已截断)*'
              : body) + footer
          );
        }

        return toolGuidance;
      } catch {
        // @ignore-catch projectContext 段落组装失败返回 null（段落缺省，不阻断 prompt）
        return null;
      }
    },
    'P1-4: 项目文件随时变更，不可缓存 — 文件写入后 prompt 立即反映'
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

  DANGEROUS_uncachedSystemPromptSection(
    'knowledgeDigest',
    async () => {
      return await generateDigestContext({ maxCount: 3, strategy: 'combined' });
    },
    'Knowledge digest updated periodically, cache 5min'
  ),

  // P1-11: Few-shot 工具使用示例
  systemPromptSection('fewShotExamples', () => {
    if (!BUILTIN_EXAMPLES || BUILTIN_EXAMPLES.length === 0) return null;
    const parts = [
      '## Tool Usage Examples',
      '',
      'Below are examples of correct tool usage to guide your behavior:',
      '',
    ];
    for (const entry of BUILTIN_EXAMPLES) {
      parts.push(renderFewShotPrompt(entry));
    }
    return parts.join('\n');
  }),

  // 2026-09-01：知识库保存指引——知识库保存是系统核心能力，封装为 knowledge_save
  // 工具（KnowledgeBaseWriter）；此处仅提示模型用该工具，不引导底层手写文件。
  systemPromptSection('knowledgeSaveGuide', () => {
    return [
      '## 知识库保存',
      '',
      '当用户要求「保存到知识库 / 保存文章 / 归档内容 / 记住资料」时，',
      '使用 **knowledge_save** 工具（参数：title 标题 + content 内容）将内容保存到用户知识库：',
      '- content 为整理后的 Markdown 正文',
      '- 可选参数：category 分类、tags 标签',
      '- 系统负责写入、溯源（frontmatter）与索引联动，无需其他操作',
    ].join('\n');
  }),
];

/**
 * 本地模型专用工具使用段落（PromptAssembler local 模式替换 toolUse 使用）：
 * 去掉"必要时等待用户确认"的确认倾向——弱本地模型（7B 量化）会过度遵循该规则，
 * 即使被用户要求执行仍反复输出"请确认"导致死循环（2026-08-22 排查导出文件确认）。
 */
export const localToolUseSection = systemPromptSection('localToolUse', () => {
  return `## 工具使用\n\n你可以使用一系列工具与用户的系统进行交互。\n使用这些工具帮助用户完成任务。\n\n执行时：\n- 直接执行用户要求的操作，不要在回复末尾请求确认（除非任务存在真实的多义性需要澄清）\n- 先读取相关文件再分析或修改\n- 做精准、最小化的修改\n- 完成后清晰地报告结果\n\n## 输出规范\n\n推理、探索、工具使用的过程叙述只允许放在思考通道（thinking）内，正文只输出对用户问题的最终回答。禁止把工具执行过程叙述混入正文。`;
});

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
  getFrozenSnapshotService().unfreezeAll();
}
