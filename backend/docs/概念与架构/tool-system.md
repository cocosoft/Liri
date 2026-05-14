# 工具系统

## 概述

工具系统是 Agent 与外部世界交互的桥梁。Agent 通过工具执行文件操作、网络请求、代码执行等任务。

## 工具定义

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
  execute(params: unknown): Promise<ToolResult>;
}
```

## 工具注册

```typescript
// 注册系统工具
toolRegistry.register(new FileReadTool());
toolRegistry.register(new FileWriteTool());
toolRegistry.register(new BashTool());

// 通过插件注册工具
plugin.registerTool("custom_tool", {
  description: "我的自定义工具",
  execute: async (params) => { /* ... */ }
});
```

## 工具执行流程

```
Agent 选择工具 → 验证参数 → 权限检查 → 执行 → 返回结果
                                         ↓
                                     审计日志
```

## 工具分类

| 类别 | 工具 | 说明 |
|------|------|------|
| 文件 | file_read, file_write, FileEditTool | 文件操作 |
| 网络 | web_fetch, web_search | 网络访问 |
| 系统 | Bash | 命令执行 |
| 媒体 | ImageGeneration, TTS | 媒体生成 |
| 浏览器 | Browser | 浏览器控制 |
| 代码 | CodeExecution | 代码运行 |
| AI | Thinking, MCP | AI 工具 |

## 工具安全

所有工具执行前经过治理系统安全检查：

- 路径验证（文件工具）
- 命令白名单（Bash 工具）
- URL 白名单（网络工具）
- 频率限制（所有工具）
