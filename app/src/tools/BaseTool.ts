// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P4（2026-11-21）—— 原址**转发**。工具基类契约已下沉至 `packages/tool-base`。
 *
 * 保留本路径使 `tools/**` 内 57 处 `from '../BaseTool'` **零改动**（同 `types/*` 的「方案甲」口径）。
 * 新代码请直接 `import { BaseTool } from '@openliri/tool-base'`。
 */
export { BaseTool } from '@openliri/tool-base';
export type { ToolDef } from '@openliri/tool-base';
export { buildTool } from '@openliri/tool-base';
