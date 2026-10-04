# 预存错误 — H 类（IDE 实时检测新增项）

> **建立日期**: 2026-06-03
> **维护原则**: 遵循 [PY_APP.md §5](file:///E:/PY/CODES/Liri/.trae/rules/PY_APP.md#L103-L111) "发现即记录" 原则
> **关联清单**: `dev_docs/error_repairs/预存错误与待处理问题.md`（A-G 类）

---

## 概述

本文件记录 IDE 实时检测（TypeScript 编译、ESLint 等）在主报告生成后**额外发现**的预存问题，单独归档以避免污染主清单。后续如需合并，请编辑 A-G 主清单后删除本文件。

---

## H 类：TypeScript 编译错误

### H-001 ✅ 已修复（原 P0）— MCP marketplace.toggleTool 已存在且调用点已迁移

- **状态**: ✅ **已修复 / 已不成立**（2026-10-04 复核：`bun run typecheck` **exit 0**）
- **原位置（已迁移）**: `app/src/core/gateway/local/LocalHTTPService.ts:6119` —— 该路径**已不存在**；`LocalHTTPService` 现位于 `app/src/infrastructure/http/LocalHTTPService.ts`（拆分为 `LocalHTTPService` / `LocalHTTPServiceHelpers` / `LocalHTTPServiceSSE`）
- **现调用点**: `app/src/infrastructure/http/handlers/mcp-marketplace-handlers.ts:517`（`handleMCPToggleTool`），第 540 行调用 `mcpSystem.marketplace.toggleTool(serverName || toolName, toolName, enabled)`
- **现方法定义**: `app/src/services/mcp/marketplace/MCPMarketplace.ts:243` —— `toggleTool(serverName: string, toolName: string, enabled: boolean): void`
- **结论**: 原报"类型 `MCPMarketplace` 上不存在属性 `toggleTool`"**已不成立** —— 方法已实现（签名与调用点一致），且全量 `tsc --noEmit`（app / scripts / root-scripts 三配置）**0 error**。**无需改码**。
- **复核记录（2026-10-04，证据驱动）**:
  - `MCPMarketplace.toggleTool` 存在：`app/src/services/mcp/marketplace/MCPMarketplace.ts:243-248`
  - 调用点签名匹配：`mcp-marketplace-handlers.ts:540-544`
  - 路由 `PATCH /v1/mcp/tools/:toolName/toggle` 注册于 `handlers/routes/marketplace-mcp-routes.ts:214-215`
  - `bun run typecheck`（`app/`）**exit 0**

---

## 总结

**H 类问题数**: 1 项
- P0: 1 项
- 状态: **全部已修复 / 已不成立**（H-001 于 2026-10-04 复核关闭；`bun run typecheck` exit 0）

---

**文档版本**: v1.1
**最后更新**: 2026-10-04（H-001 复核关闭）
**检测来源**: IDE 实时 TypeScript 检查
