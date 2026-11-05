/**
 * ChatManager 构造期装配（A 批外移，2026-11-05）
 *
 * 背景：`ChatManager` 曾有 8 个"构造期 helper"以内联字段初始化的形式存在（每个约 10–20 行、
 * 带一段历史注释），合计约 156 行"粘合代码"。本例把它们收敛到**单一装配函数**：
 *  - `ChatManager` 只保留 `_helpers` 一次构造 + 8 个同名字段别名（调用点逐字不变）；
 *  - 各 helper 的依赖以**惰性 getter**注入（与原实现一致）⇒ 无初始化顺序陷阱
 *    （`_toolCallSeqMap` / `_msgPersist` 等字段声明在后也安全，闭包不在构造期求值）。
 *
 * 口径：**只搬装配，不改类型与调用点**；字段名/方法名对 59 个按名 mock 的测试面保持不变。
 */

import type { ChatBootstrapDeps } from './bootstrap';
import type { ChatEventLogStoreDeps } from './eventLogStore';
import type { ChatPromptAssemblyDeps } from './promptAssembly';
import type { ChatRecoveryDeps } from './recovery';
import type { ChatRequestPrepDeps } from './requestPrep';
import type { ChatRollbackDeps } from './rollback';
import type { ChatSessionTeardownDeps } from './sessionTeardown';
import type { ChatStreamMessageLifecycleDeps } from '../pipeline/streamMessageLifecycle';

import { ChatBootstrap } from './bootstrap';
import { ChatEventLogStore } from './eventLogStore';
import { ChatPromptAssembly } from './promptAssembly';
import { ChatRecovery } from './recovery';
import { ChatRequestPrep } from './requestPrep';
import { ChatRollback } from './rollback';
import { ChatSessionTeardown } from './sessionTeardown';
import { ChatStreamMessageLifecycle } from '../pipeline/streamMessageLifecycle';

/**
 * 装配所需的全部惰性访问器（8 个 helper 的 deps 取交集）。
 *
 * 以**访问器闭包**而非宿主实例传入：这些依赖大多是宿主私有字段，
 * 直接传 `this` 会引入 private 可赋值性约束；闭包形式与各 deps 的既有形状一致。
 */
export type ChatManagerHelpersHost = ChatEventLogStoreDeps &
  ChatRequestPrepDeps &
  ChatRollbackDeps &
  ChatPromptAssemblyDeps &
  ChatBootstrapDeps &
  ChatStreamMessageLifecycleDeps &
  ChatSessionTeardownDeps &
  ChatRecoveryDeps;

/** 8 个构造期 helper（字段名与 ChatManager 内别名一一对应） */
export interface ChatManagerHelpers {
  eventLogStore: ChatEventLogStore;
  requestPrep: ChatRequestPrep;
  rollback: ChatRollback;
  promptAssembly: ChatPromptAssembly;
  bootstrap: ChatBootstrap;
  streamMessageLifecycle: ChatStreamMessageLifecycle;
  sessionTeardown: ChatSessionTeardown;
  recovery: ChatRecovery;
}

/**
 * 构造 8 个 helper（顺序与原字段声明顺序一致，便于对照历史行为）。
 *
 * 历史说明（原内联注释摘要）：
 * - `eventLogStore`：事件日志实例缓存与 LRU 淘汰（原 `_eventLogCache`）；
 * - `requestPrep`：请求构建 / 快照 / 压缩（C14 簇）；
 * - `rollback`：交互解析 + 文件回滚轮次（C19 簇）；
 * - `promptAssembly`：系统提示词组装（C12 簇）；
 * - `bootstrap`：启动加载 / 迁移 / 初始化（C13 簇）；
 * - `streamMessageLifecycle`：流式请求的消息构建（切窗标记仍归宿主）；
 * - `sessionTeardown`：会话拆除与级联收口（C21 的 2 个对外入口）；
 * - `recovery`：启动期恢复装配 / yield 恢复器 / 会话内部续跑（C18 簇）。
 */
export function buildChatManagerHelpers(
  host: ChatManagerHelpersHost
): ChatManagerHelpers {
  return {
    eventLogStore: new ChatEventLogStore(host),
    requestPrep: new ChatRequestPrep(host),
    rollback: new ChatRollback(host),
    promptAssembly: new ChatPromptAssembly(host),
    bootstrap: new ChatBootstrap(host),
    streamMessageLifecycle: new ChatStreamMessageLifecycle(host),
    sessionTeardown: new ChatSessionTeardown(host),
    recovery: new ChatRecovery(host),
  };
}
