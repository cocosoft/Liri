// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-10-20（U-02 v2 / P3）：**原址转发**。
 *
 * 实现已下沉到 `utils/toolContract/pathBoundary`（infra）—— 因
 * `chat/services/ToolExecutionService` 也要做同一越界判定，而 chat（app）反向
 * import `tasks`（app）会与「`tasks → chat`」形成模块环。
 *
 * 保留本文件的目的：LRO 既有 import（`stepExecution.ts`）与回归测试
 * （`tests/tasks/lroWorkspaceGuard.test.ts`）**零改动**。
 */
export {
  findWorkspaceEscape,
  type WorkspaceEscape,
  type WorkspaceGuardDeps,
} from '@modules/utils/toolContract';
