"""
liri — Liri Python 插件 SDK（PY-2）

Python 开发者用与 TS SDK 对等的心智模型编写插件（工具/技能 + 声明式服务注入）。

对齐 TS plugin-sdk 契约：
- Plugin / PluginContext / @tool / @skill / inject / injectOptional
- services 为 lazy RPC 代理（方法调用即跨进程 RPC，await 化）

协议（与 JsonRpcBridge 对齐，行分隔 JSON）：
- 启动：子进程主动发 {"type":"startup","pid":...}
- 请求：主进程发 {"id":...,"method":...,"params":...}，子进程回 {"id":...,"success":...,"result":...}
- 通知：主进程→子进程 {"type":"notify",...}；子进程→主进程 {"type":"notify","event":...,"data":...}
- 关闭：协议 shutdown 帧 或 "__SHUTDOWN__" 裸行
"""

from .plugin import Plugin, PluginContext, tool, skill
from .version import __version__

__all__ = ["Plugin", "PluginContext", "tool", "skill", "__version__"]
