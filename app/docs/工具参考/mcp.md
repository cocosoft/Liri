# MCP - 模型上下文协议

## 概述

MCP (Model Context Protocol) 允许 Agent 与外部 MCP 服务器通信，扩展能力边界。Liri 的 MCP 体系分两层：

- **标准层**（`app/src/services/mcp/`）：实现（连接管理、市场、工具桥接、认证、缓存、安全过滤）
- **增强层入口**（`app/src/mcp/`）：统一导出面（`@modules/mcp`），供插件 SDK / HTTP handler 消费

## 配置文件（双源职责边界）

| 文件 | 位置 | 职责 | 管理方 |
|------|------|------|--------|
| `mcp.json` | `~/.pyapp/mcp.json`（全局）/ `~/.pyapp/user/mcp.json`（用户）/ `<项目根>/.mcp.json`（项目） | **服务器连接参数**（command/args/env/transport） | `EnhancedMCPConfigManager`（三级合并，环境变量 `MCP_SERVER_*` 为动态源） |
| `servers.json` | `~/.pyapp/mcp/servers.json` + `~/.pyapp/mcp/cache` | **安装记录**（installedFrom/sourceRegistry/enabled/disabledTools） | `LocalServerStore`（市场安装元数据） |

> 边界：`mcp.json` 是"如何连接"，`servers.json` 是"装了什么"。首次启动 `~/.pyapp/mcp/` 目录自动创建，`mcp.json` 缺失不报错（容错加载）。

## 市场

`/v1/mcp/marketplace/*` 提供第三方注册表搜索与安装。默认接入的第三方来源（2026-08-06）：

| 来源 | 类型 | 说明 |
|------|------|------|
| GitHub / NPM | 搜索 API | 通过平台 API 搜索 MCP 仓库/包 |
| Smithery.ai | 搜索 API | `registry.smithery.ai` 真实搜索（官方 API） |
| MCP.so / MCPMarket.cn / 魔搭 MCP 广场 / mcp-marketplace.io | 预设入口 | 无公开搜索 API——作为来源入口展示，安装走**手动来源**（从市场官网复制 command/URL 手动添加） |

功能：
- `search` / `categories` / `registries`：市场浏览（预设来源搜索返回空并提示手动安装）
- `installed` / `servers/:id`（详情）/ `install` / `uninstall` / `toggle`：安装管理
- `servers/:id/verify`：连接验证
- 工具管理：`/v1/mcp/tools`（列表）、`/v1/mcp/tools/:name/toggle`（启用/禁用）

**离线回退（2026-08-06）**：市场搜索结果落盘缓存到 `~/.pyapp/mcp/cache/marketplace-search.json`（TTL 10 分钟），网络失败时返回缓存结果。

## 多传输支持

| 传输 | 说明 |
|------|------|
| stdio | 本地进程（如 Python 脚本 `python server.py`），`type: 'stdio'` |
| SSE / WebSocket | 远程 HTTP 事件流，`type: 'sse'` / `type: 'ws'` |
| HTTP | 流式 HTTP，`type: 'http'` |

## OAuth

`/v1/mcp/oauth/callback` 处理服务器 OAuth 回调，凭据加密落盘（无 `OAUTH_ENCRYPTION_KEY` 时拒绝保存）。`mcpAuthManager` 提供令牌刷新与状态管理。

## 工具与资源

- **工具桥接**：已连接服务器的工具经 `MCPToolBridge` 注册到 ToolManager，Agent 通过 `MCPTool` 调用（list_servers / connect / list_tools / call）
- **资源与命令**：`resourceManager` / `commandManager` 管理服务器资源与自定义命令
- **权限**：`channelPermissions` 提供服务器级资源/工具访问控制；`MCPSecurityFilter` 对工具结果凭据脱敏

## 并发控制边界（2026-08-06 声明）

| 机制 | 位置 | 职责 |
|------|------|------|
| `batchInterval`（100ms） | `MCPConnection.ts` | 客户端请求批处理（同一连接内合并高频调用） |
| `MCPRequestQueue` | `modules/doc/` | 文档模块请求排队（doc 专用，服务器端顺序化） |

> 两者分层不同、无重复实现：前者是标准层客户端行为，后者是业务模块内部调度。

## 安全

- **工具调用审计（2026-08-06）**：`McpToolWrapper.execute` 记录 server/tool/耗时/结果日志（module `services:mcp:toolWrapper`）
- **安装来源审计**：安装时记录 `installedFrom` / `sourceRegistry`
- **SSRF 防护**：远程注册表与 OAuth 端点经 `checkSsrf` 校验，拦截内网/环回/元数据地址

## SDK 版本基线

`@modelcontextprotocol/sdk` **^1.29.0**（保持，不升级——升级需专项回归 MCPConnection）。
