// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `prompt_snippet` 动态段（红线 S3，2026-11-15）
 *
 * 规格：`.trae/specs/prompt-snippet-injection-redline.md` §4.1 / §6-S3。
 *
 * 三条硬约束（S3 的核心）：
 * - **默认关闭**：只有 `LIRI_PROMPT_SNIPPET=1|true` 才注入；未设置/其它值 ⇒ 返回 `null`（零行为变更）；
 * - **只在动态区**：用 `DANGEROUS_uncachedSystemPromptSection`（`cacheBreak: true`）⇒ 稳定前缀逐字不变；
 * - **只增不改**：本段是 `extraDynamicSections` 的**追加项**，不触碰 `SECTION_NAMES` / 任何既有段。
 *
 * 作用域（spec §7-2）：只注入 `workspaceId` 等于当前项目根的片段；项目根按
 * 「正斜杠 + 小写」归一（与本文件同一函数，创建侧必须复用，避免两套键）。
 */

import { configManager } from '@openliri/infra/config';
import { resolveProjectRoot } from '@openliri/infra/environment';
import {
  DANGEROUS_uncachedSystemPromptSection,
  type SystemPromptSection,
} from '@openliri/infra/constants/systemPromptSections';
import { PromptSnippetStore, renderPromptSnippetSection } from '@modules/tasks';

/** 总开关环境变量名（缺省关闭；仅 `1` / `true` 视为打开） */
export const PROMPT_SNIPPET_ENABLE_ENV = 'LIRI_PROMPT_SNIPPET';

/** 动态段名（不进 `SECTION_NAMES`，只作 extra 段标识） */
export const PROMPT_SNIPPET_SECTION_NAME = 'promptSnippet';

/** 是否启用（kill switch；读统一配置门面，不直接读 `process.env`） */
export function isPromptSnippetEnabled(): boolean {
  const raw = configManager
    .env(PROMPT_SNIPPET_ENABLE_ENV)
    ?.trim()
    .toLowerCase();
  return raw === '1' || raw === 'true';
}

/**
 * 项目作用域键（正斜杠 + 小写）。
 *
 * 创建片段时必须用同一函数生成 `workspaceId`，否则注入侧永远匹配不到。
 */
export function promptSnippetWorkspaceId(
  root: string = resolveProjectRoot()
): string {
  return root.replace(/\\/g, '/').toLowerCase();
}

/** 构建动态段（关闭 / 无片段 / 空渲染 ⇒ `null`，调用方不追加） */
export function buildPromptSnippetSection(options?: {
  store?: PromptSnippetStore;
  workspaceId?: string;
  now?: number;
}): SystemPromptSection | null {
  if (!isPromptSnippetEnabled()) return null;
  const store = options?.store ?? new PromptSnippetStore();
  const workspaceId = options?.workspaceId ?? promptSnippetWorkspaceId();
  const items = store.list().filter((item) => item.workspaceId === workspaceId);
  const rendered = renderPromptSnippetSection(
    items,
    options?.now ?? Date.now()
  );
  if (!rendered.text) return null;
  return DANGEROUS_uncachedSystemPromptSection(
    PROMPT_SNIPPET_SECTION_NAME,
    () => `## 学习片段（人工批准，带有效期）\n${rendered.text}`,
    '片段随批准/撤销/到期变化；放动态区以免击穿稳定前缀缓存'
  );
}
