/**
 * 2026-10-01 B18-b（方案甲）—— 原址**转发**。契约实现已下沉至 `src/utils/toolContract/`（utils/infra 层）。
 *
 * 保留本路径使 `tools/**` 内约 230 处相对引用（`'../types/<Name>'` 等）**零改动**；
 * 依用户裁定「方案甲」明确接受本组转发文件。目标消费方
 * （`services/mcp/McpToolWrapper.ts`、`mcp/MCPTool.ts`）已直指新落点。
 */
export * from '@modules/utils/toolContract/Tool';
