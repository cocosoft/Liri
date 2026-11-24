// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * toolKinds — 工具**读/写类别**名称清单（单一事实源）。
 *
 * 为什么放在 infra：`chat`（长任务信号）与 `query`（`PathGuard` / `FileIOLoopDetector`）
 * 都需要"这个工具是否只读"，而 app 侧**禁止直接 import `query`**（`module-registry/no-direct-module-import`）
 * ⇒ 明细收敛到叶子常量模块，两侧各自取用、不重复维护。
 *
 * ⚠️ 取值为**真实注册名**（`app/src/tools/**` 的 `name = '...'`）；由 `satisfies readonly ToolName[]`
 * 做编译期校验（拼错 / 改名未同步 ⇒ `typecheck` 报错）。防回退守卫：`tests/tools/toolNameLists.test.ts`。
 *
 * @kind-default B
 */

import type { ToolName } from './toolNames.generated';

/** 整文件读工具（入参键 = `file_path` / `relativePath`） */
export const FILE_READ_TOOL_NAMES = [
  'file_read',
  // 2026-11-19：项目文件夹读工具此前不在清单 ⇒ 重复读不追踪（fail-open）
  'read_project_file',
] as const satisfies readonly ToolName[];

/** 搜索类读工具（入参键 = `path` / `searchPath`） */
export const SEARCH_TOOL_NAMES = ['glob', 'grep'] as const satisfies readonly ToolName[];

/** 读类工具并集（"只读调查"判据：全部工具都落在这里 ⇒ 没有产出动作） */
export const READ_TOOL_NAMES = [
  ...FILE_READ_TOOL_NAMES,
  ...SEARCH_TOOL_NAMES,
] as const;

/** 读类工具集合（便捷判定用） */
export const READ_TOOLS: Set<string> = new Set<string>(READ_TOOL_NAMES);
