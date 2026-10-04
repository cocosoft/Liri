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
} from '@modules/constants';
import { clearSoulCache } from '@modules/services/soul/SoulReader';
import { clearUserCache } from '@modules/services/soul/UserReader';
// 2026-10-01 D-219（子批 E `workspaces` 组）：原经 `@modules/services/workspace`
// 转出 barrel 取用（该 barrel 属 service 层、仅本模块与 builtinSections 消费）
// ⇒ 改**直连 app 同层** `@modules/workspaces`，barrel 随之删除（零端口、零白名单）。
import { clearWorkspaceCache } from '@modules/workspaces/WorkspaceScanner';
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
