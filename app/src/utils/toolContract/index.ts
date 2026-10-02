/**
 * 工具契约类型（infra 层）—— 2026-10-01 B18-b（方案甲）下沉，R05-013 收口改落点。
 *
 * 沿革：B18-b 曾落 `src/types/tools/`（core 类型中心）；因类型中心混入"与其它模块本地定义同名"的类型
 * 触发门禁 R05-013（`checkTypeCenterDuplicates`）⇒ 改落本处（`src/utils/toolContract/`，utils = infra，非类型中心）。
 * 动机：解除 `services/mcp/*` 与 `mcp/*`（均 service）经 `@modules/tools`(app) 取**工具契约**的倒挂。
 *
 * **出向依赖实测：全部 `@modules/core` + 本目录内部** ⇒ 下沉净差 0（不新增任何跨层边）。
 *
 * **为何类型与随行值（`createToolResult` / `ToolProgress` 工厂 / `ToolTag` 枚举等）同处**：
 * 依 §9.2「一个名字一个规范落点」—— 把 `ToolResult` 类型与其工厂拆到两层会**碎片化同一契约**。
 *
 * **取用路径**：`@modules/utils/toolContract`。
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
