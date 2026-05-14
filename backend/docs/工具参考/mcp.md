# MCP - 模型上下文协议工具

## 描述

MCP (Model Context Protocol) 工具允许 Agent 与外部 MCP 服务器通信，扩展 Agent 的能力边界。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `server` | string | 是 | MCP 服务器标识 |

## MCP 服务器

MCP 工具连接到外部 MCP 服务器，提供额外的工具和资源：

- **浏览器控制**: Chrome DevTools 集成
- **版本控制**: Git 操作
- **数据库**: 数据库查询和管理
- **云服务**: AWS、Azure 等云平台管理

## 配置

```json
{
  "mcp": {
    "servers": {
      "browser": {
        "command": "npx",
        "args": ["@anthropic/chrome-devtools-mcp"]
      },
      "git": {
        "command": "npx",
        "args": ["@anthropic/git-mcp"]
      }
    }
  }
}
```

## 使用场景

- 浏览器自动化和测试
- Git 版本控制操作
- 数据库管理和查询
- 云资源管理
