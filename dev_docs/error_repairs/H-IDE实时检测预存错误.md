# 预存错误 — H 类（IDE 实时检测新增项）

> **建立日期**: 2026-06-03
> **维护原则**: 遵循 [PY_APP.md §5](file:///E:/PY/CODES/Liri/.trae/rules/PY_APP.md#L103-L111) "发现即记录" 原则
> **关联清单**: `dev_docs/error_repairs/预存错误与待处理问题.md`（A-G 类）

---

## 概述

本文件记录 IDE 实时检测（TypeScript 编译、ESLint 等）在主报告生成后**额外发现**的预存问题，单独归档以避免污染主清单。后续如需合并，请编辑 A-G 主清单后删除本文件。

---

## H 类：TypeScript 编译错误

### H-001 ❌ P0 — `LocalHTTPService.ts:6119` MCP marketplace.toggleTool 不存在

- **状态**: 未修复
- **位置**: `app/src/core/gateway/local/LocalHTTPService.ts` 第 6119 行
- **完整方法**: `handleMCPToggleTool` (6096-6130 行)
- **代码**:
  ```typescript
  // 工具级启用/禁用通过 marketplace 的 tool toggle 实现
  const { mcpSystem } = await import('@modules/services/mcp');
  await mcpSystem.marketplace.toggleTool(
    serverName || toolName,
    toolName,
    enabled
  );
  ```
- **错误信息**: `类型"MCPMarketplace"上不存在属性"toggleTool"`
- **影响**: `PATCH /v1/mcp/tools/:toolName/toggle` 端点会编译失败
- **范围**: 该路由在 1022-1031 行注册（`/v1/mcp/tools/:toolName/toggle`）
- **修复建议**:
  1. 核查 `app/src/services/mcp/` 下 `MCPMarketplace` 接口定义
  2. 若不存在 `toggleTool` 方法：实现该方法或使用现有 `enableTool`/`disableTool` 替代
  3. 若签名不匹配：调整参数顺序（建议签名：`toggleTool(serverName: string, toolName: string, enabled: boolean)`）
- **关联文件**:
  - `app/src/services/mcp/MCPMarketplace`（待定位）
  - `app/src/services/mcp/officialRegistry.ts`（含 marketplace 逻辑）

---

## 总结

**H 类问题数**: 1 项
- P0: 1 项
- 状态: 全部未修复

---

**文档版本**: v1.0
**最后更新**: 2026-06-03 07:29
**检测来源**: IDE 实时 TypeScript 检查
