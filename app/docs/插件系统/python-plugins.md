# Python 插件开发指南

> 基于 [Python SDK 设计方案](../20260825/PythonSDK设计方案-20260825.md) 的实现，Python 插件经 `PythonPluginAdapter` 接入插件体系。

## 快速开始

```bash
# 通过脚手架生成 Python 插件模板（app 目录下）
bun x tsx -e "import { writePluginTemplate } from '@modules/plugin-sdk'; writePluginTemplate('./hello-python', { id: 'hello-python', name: 'Hello Python', description: '示例', author: 'you', language: 'python' })"
```

生成结构：

```
hello-python/
├── plugin.json   # 桥接清单（type: python, entry.python: main.py）
├── main.py       # 插件入口（liri SDK）
└── README.md
```

## 编写插件

```python
from liri import Plugin, PluginToolResult, tool, tool_fail, tool_ok


@tool(name="greet", description="向用户打招呼", params={"name": "称呼"})
async def greet(name: str, ctx=None) -> PluginToolResult:
    # ctx.services 可访问注入的内核服务（lazy RPC 代理，方法调用需 await）
    if not name:
        # 显式失败契约：映射为 ToolResult.success=false / error
        return tool_fail("name 不能为空")
    # 成功：data 为结果载荷
    return tool_ok(f"Hello, {name}")


plugin = Plugin(
    id="hello-python",
    name="Hello Python",
    version="0.1.0",
    tools=[greet],
    inject=["session_manager"],   # 声明式服务注入（与 TS inject 对齐）
)

# 入口：python main.py（脚本风格，v1）
plugin.run()
```

## 桥接清单（plugin.json）

安装时由 `PythonPluginInstaller` 自动生成（已定案 b），`PluginLoader` 文件发现链路据此识别 Python 插件：

```json
{
  "id": "hello-python",
  "name": "Hello Python",
  "type": "python",
  "entry": { "python": "main.py" },
  "python": ">=3.10"
}
```

## 与 TS SDK 的语义差异（重要）

| 差异点           | TS SDK                                                                                   | Python SDK（liri）                                                 |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 工具声明         | `createPlugin({ tools: [...] })`（声明式）                                               | `@tool` 装饰器 + `Plugin(tools=[...])`                             |
| 工具返回契约     | `PluginToolResult`（成功 `{ success: true, data? }` / 失败 `{ success: false, error }`） | `tool_ok(data)` / `tool_fail(error)`；抛异常等价失败               |
| 命令（commands） | 无此概念                                                                                 | **首版不支持**（砍掉，见设计文档 P0-1）                            |
| 服务注入         | 同步挂载实例（`ctx.services.get(id)` 同步）                                              | **方法调用 await 化**（跨进程 RPC 代理）                           |
| 工具 ctx 参数    | `ToolRegistration.execute(args)` 无 ctx                                                  | 可声明可选 `ctx` 参数，适配器注入白名单字段                        |
| 参数 schema      | TypeScript 类型（编译器）                                                                | type hints → JSON Schema（自研轻量解析，非 pydantic）              |
| 日志通道         | 宿主注入 logger                                                                          | **stdout 仅限协议帧**，日志走 stderr                               |
| 会话状态         | 进程内对象，调用天然隔离                                                                 | 插件进程全局一个、多会话共享——**禁止进程级全局可变状态存会话数据** |

## 运行时约束

1. **stdout 仅限协议帧**：插件 `print()` 输出会被主进程静默丢弃；调试用 `ctx.logger`（走 stderr）
2. **长任务**：工具函数建议 async 化（runner 已用线程池隔离同步阻塞，health 不被误杀）
3. **配置**：`ctx.config.get/set/save` 跨进程 RPC，主进程按 pluginId 持久化 JSON（deactivate 保留、uninstall 清除）
4. **事件**：`ctx.events.on/off/emit` 跨进程 RPC；系统事件 → 插件方向走 notify（需先 subscribeEvent）

## 测试

- SDK 包单测：`python sdk/tests/run_tests.py`（无框架依赖）
- 适配器集成：`bun run test -- --run PythonPluginAdapter.test.ts`（需系统 Python）
