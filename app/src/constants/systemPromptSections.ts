/**
 * 系统提示词段落框架（infra）
 * 提供系统提示词段落的创建、解析和缓存管理。
 *
 * 2026-10-01 分层拆分（spec: `.trae/specs/prompt-sections-layer-split.md`）：
 * 本文件**只保留框架**（类型 / 工厂 / 缓存 / 注册槽），不含任何 app / service 依赖。
 * - 内置段落定义 → `context/promptSections/builtinSections.ts`（app）
 * - 缓存清理回调 + 注册入口 → `context/promptSections/index.ts`（app）
 */

import { getFrozenSnapshotService } from '@modules/memory';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('constants:systemPromptSections');

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
export type SystemPromptSection<N extends string = string> = {
  name: N;
  compute: ComputeFn;
  cacheBreak: boolean;
};

/**
 * 段落缓存
 * 在/clear或/compact时清除
 */
export const sectionCache = new Map<string, string | null>();

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
export function systemPromptSection<N extends string>(
  name: N,
  compute: ComputeFn
): SystemPromptSection<N> {
  return { name, compute, cacheBreak: false };
}

/**
 * 创建易变的系统提示词段落
 * 每轮重新计算，值变化时会破坏提示缓存
 * 需要提供原因说明为何需要破坏缓存
 */
export function DANGEROUS_uncachedSystemPromptSection<N extends string>(
  name: N,
  compute: ComputeFn,
  _reason: string
): SystemPromptSection<N> {
  return { name, compute, cacheBreak: true };
}

/** Phase 2: 简单字符串 hash（djb2，用于内容缓存保护） */
export function hashString(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/** Phase 2: 记忆内容 hash 缓存（保护 LLM 提示缓存） */
let memoryContentHash = '';

/** 读取记忆内容 hash（供 app 侧 memoryContext 段落做缓存保护判定） */
export function getMemoryContentHash(): string {
  return memoryContentHash;
}

/** 写入记忆内容 hash（供 app 侧 memoryContext 段落做缓存保护判定） */
export function setMemoryContentHash(hash: string): void {
  memoryContentHash = hash;
}

/**
 * 内置段落名（有序）—— **顺序的唯一事实源**。
 *
 * `StaticPromptSectionName` 由其**推导**（非手工联合）；app 侧内置段落对象按键名与之对齐，
 * 未注册前的段顺序由本清单决定（见 `getRegisteredSections()`）。
 *
 * 导出供测试锁定「注册后段顺序 == 本清单顺序」（P1-4 T4①，2026-10-05）。
 */
export const SECTION_NAMES = [
  'identity',
  'projectRules',
  'toolsConvention',
  'toolUse',
  'toolIntegrity',
  'shellDeclaration',
  'taskNegotiation',
  'pdcaThinking',
  'userProfile',
  'personality',
  'memoryContext',
  // T-②06（2026-10-03）：经验自动演化产物（受管覆盖层，空时不注入）
  'promptEvolution',
  'gitContext',
  'projectMeta',
  'skills',
  'sessionContext',
  'projectContext',
  'knowledgeContext',
  'knowledgeDigest',
  'fewShotExamples',
  'knowledgeSaveGuide',
  'outputArtifactBoundary',
] as const;

/**
 * 静态段落名联合（由 `SECTION_NAMES` **推导**，非手工清单）。
 *
 * 用途：`services/prompt/promptSectionLayers.ts` 的 `SECTION_META` 以
 * `satisfies Record<StaticPromptSectionName, PromptSectionMeta>` 做**穷尽登记校验** ——
 * 新增静态段却不登记 ⇒ **编译失败**。
 *
 * 为什么需要这道门禁：未登记段 = 仅 full 模式可见（`isSectionVisibleIn` 的 `?? false`），
 * 漏登记会**静默失效**（既不报错也不进提示词）。已实机踩过：`outputArtifactBoundary`
 * 在 `mode=conversation` 下完全不注入，两次实机验证才暴露（台账 N-60）。
 */
export type StaticPromptSectionName = (typeof SECTION_NAMES)[number];

/** 内置段落（app 侧注入槽）—— 避免 `infra -> app` 倒挂 */
let _builtinSections: Record<
  StaticPromptSectionName,
  SystemPromptSection
> | null = null;

/** 段落缓存清理回调（app/service 侧注入槽） */
let _sectionCacheClearers: Array<() => void> = [];

/** 未注册即 resolve 时的一次性告警标记 */
let _warnedUnregisteredSections = false;

/** 注册内置段落（app 侧启动期调用一次） */
export function registerBuiltinSections(
  sections: Record<StaticPromptSectionName, SystemPromptSection>
): void {
  _builtinSections = sections;
}

/** 注册段落缓存清理器（app 侧启动期调用一次） */
export function registerSectionCacheClearers(
  clearers: Array<() => void>
): void {
  _sectionCacheClearers = clearers;
}

/**
 * 测试专用：把注入槽重置为**未注册态**（`_builtinSections = null`）。
 *
 * 用途：锁定「未注册 ⇒ `getRegisteredSections()` 返回空数组」这一兜底契约
 * （P1-4 T4②，2026-10-05）—— 该分支在生产只在启动注册前短暂存在，进程级单例下
 * 无法用常规用例触达。**测后必须重新 `registerPromptSections()` 复原**
 * （见 `promptSectionLayersGate.test.ts` 的 afterAll）。
 */
export function resetBuiltinSectionsForTest(): void {
  _builtinSections = null;
  registeredSections = [];
  _warnedUnregisteredSections = false;
}

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
 *
 * 优先级：显式注册（`registerSections`）→ 内置段落（`registerBuiltinSections`，按
 * `SECTION_NAMES` 顺序组装）→ 空数组（未注册时打一次告警，避免静默空提示词）。
 */
export function getRegisteredSections(): SystemPromptSection[] {
  if (registeredSections.length > 0) return registeredSections;
  const builtin = _builtinSections;
  if (builtin) {
    return SECTION_NAMES.map((n) => builtin[n]);
  }
  if (!_warnedUnregisteredSections) {
    _warnedUnregisteredSections = true;
    logger.warning(
      '内置提示词段落尚未注册（registerPromptSections 未调用？），getRegisteredSections() 返回空数组'
    );
  }
  return [];
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
  for (const clear of _sectionCacheClearers) clear();
  getFrozenSnapshotService().unfreezeAll();
}
