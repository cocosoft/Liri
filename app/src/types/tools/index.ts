/**
 * 工具契约类型中心（core 层）—— 2026-10-01 B18-b（方案甲）下沉。
 *
 * 原址 `app/src/tools/types/`（app 层）⇒ 本处（`src/types/tools/`，core）。
 * 动机：解除 `services/mcp/*` 与 `mcp/*`（均 service）经 `@modules/tools`(app) 取**工具契约**的倒挂。
 *
 * **出向依赖实测：全部 `@modules/core` + 本目录内部** ⇒ 下沉净差 0（不新增任何跨层边）。
 *
 * **为何类型与随行值（`createToolResult` / `ToolProgress` 工厂 / `ToolTag` 枚举等）同处**：
 * 依 §9.2「一个名字一个规范落点」—— 把 `ToolResult` 类型与其工厂拆到两层会**碎片化同一契约**。
 *
 * **取用路径**：`@modules/types/tools`（1 段子路径，与 `@modules/types/goal` 等同类约定一致）。
 * 注意：**不转出** `ToolTypes` 与 `ToolProgressData`（后者与 `ToolProgress.ts` 的同名 union **同名不同物**，
 * 同桶并存会产生歧义）⇒ 这两个模块经**原址转发文件**取用。
 */
export * from './Tool';
export * from './ToolUseContext';
export * from './ToolResult';
export * from './ToolProgress';
export * from './ToolDef';
export * from './PermissionContext';
export * from './PermissionResult';
