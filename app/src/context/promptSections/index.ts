/**
 * 系统提示词段落注册入口（app）
 *
 * 2026-10-01 分层拆分（spec: `.trae/specs/prompt-sections-layer-split.md`）：
 * 把「内置段落」与「缓存清理器」注入 infra 框架（`constants/systemPromptSections`），
 * 由应用启动期调用一次，消除 `constants`(infra) → app/service 倒挂。
 */
import {
  registerBuiltinSections,
  registerSectionCacheClearers,
} from '@modules/constants/systemPromptSections';
import { clearSoulCache } from '@modules/services/soul/SoulReader';
import { clearUserCache } from '@modules/services/soul/UserReader';
import { clearWorkspaceCache } from '@modules/services/workspace';
import { BUILTIN_SECTIONS } from './builtinSections.js';

/** 注册内置段落与缓存清理器（应用启动期调用一次） */
export function registerPromptSections(): void {
  registerBuiltinSections(BUILTIN_SECTIONS);
  registerSectionCacheClearers([
    clearSoulCache,
    clearUserCache,
    clearWorkspaceCache,
  ]);
}

export { BUILTIN_SECTIONS } from './builtinSections.js';
