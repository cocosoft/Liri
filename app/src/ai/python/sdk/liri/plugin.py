"""Plugin 类 / @tool / @skill 装饰器 / PluginContext（PY-2）

对齐 TS plugin-sdk 契约：
- Plugin: id/name/version/tools/skills/inject/injectOptional
- @tool: 声明式工具注册（name/description/parameters）
- @skill: 声明式技能注册（id/name/description/parameters）
- PluginContext: sessionId/logger/services/config/events
"""
from __future__ import annotations

import inspect
import json
import sys
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union

from .schema import schema_from_callable

# ---------------------------------------------------------------------------
# 装饰器与注册项
# ---------------------------------------------------------------------------


@dataclass
class ToolRegistration:
    """对齐 TS ToolRegistration"""

    name: str
    description: str
    parameters: Dict[str, Any]
    execute: Callable[[Dict[str, Any]], Awaitable[Any]]


@dataclass
class SkillDefinition:
    """对齐 TS SkillDefinition"""

    id: str
    name: str
    description: str
    parameters: Dict[str, Any]
    execute: Callable[..., Awaitable[Any]]


def tool(
    name: Optional[str] = None,
    description: str = "",
    params: Optional[Dict[str, str]] = None,
):
    """声明式工具注册装饰器

    用法::

        @tool(name="greet", description="向用户打招呼", params={"name": "称呼"})
        async def greet(name: str, ctx: Optional[PluginContext] = None) -> str:
            return f"Hello, {name}"

    参数：
    - name: 工具名（缺省取函数名）
    - description: 工具描述
    - params: 参数名 → 描述（可选，生成 schema description）
    """

    def decorator(fn: Callable[..., Any]) -> ToolRegistration:
        tool_name = name or fn.__name__
        parameters = schema_from_callable(fn, param_descriptions=params or {})

        async def execute(args: Dict[str, Any]) -> Any:
            # 参数展开 + ctx 注入：函数若声明 ctx 参数则注入 PluginContext
            bound = _bind_args(fn, args)
            result = fn(**bound)
            if inspect.isawaitable(result):
                result = await result
            return result

        return ToolRegistration(
            name=tool_name,
            description=description,
            parameters=parameters,
            execute=execute,
        )

    return decorator


def skill(
    id: Optional[str] = None,
    name: str = "",
    description: str = "",
    params: Optional[Dict[str, str]] = None,
):
    """声明式技能注册装饰器

    用法::

        @skill(id="summarize", name="摘要", description="总结文本")
        async def summarize(text: str) -> str:
            ...
    """

    def decorator(fn: Callable[..., Any]) -> SkillDefinition:
        skill_id = id or fn.__name__
        parameters = schema_from_callable(fn, param_descriptions=params or {})

        async def execute(args: Dict[str, Any]) -> Any:
            bound = _bind_args(fn, args)
            result = fn(**bound)
            if inspect.isawaitable(result):
                result = await result
            return result

        return SkillDefinition(
            id=skill_id,
            name=name or skill_id,
            description=description,
            parameters=parameters,
            execute=execute,
        )

    return decorator


def _bind_args(fn: Callable[..., Any], args: Dict[str, Any]) -> Dict[str, Any]:
    """把 JSON args 绑定到函数签名；ctx 参数由 runner 注入（args 中携带）"""
    sig = inspect.signature(fn)
    bound: Dict[str, Any] = {}
    for pname, param in sig.parameters.items():
        if pname in ("self", "cls"):
            continue
        if pname == "ctx":
            # ctx 由 runner 注入（args 里携带 PluginContext）
            if "ctx" in args:
                bound["ctx"] = args["ctx"]
            continue
        if pname in args:
            bound[pname] = args[pname]
        elif param.default is not inspect.Parameter.empty:
            bound[pname] = param.default
    return bound


# ---------------------------------------------------------------------------
# 服务代理（lazy RPC）
# ---------------------------------------------------------------------------


class RemoteMethod:
    """服务代理的远端方法：调用时执行跨进程 RPC（await 化）"""

    def __init__(self, service_id: str, method_name: str, rpc: Callable[..., Awaitable[Any]]):
        self._service_id = service_id
        self._method_name = method_name
        self._rpc = rpc

    def __call__(self, *args: Any, **kwargs: Any) -> Awaitable[Any]:
        return self._rpc("injectService", {
            "serviceId": self._service_id,
            "method": self._method_name,
            "args": list(args),
            "kwargs": kwargs,
        })


class ServiceProxy:
    """lazy RPC 代理：首次访问属性才跨进程取用（对齐 TS 注入语义，方法调用 await 化）"""

    def __init__(self, service_id: str, rpc: Callable[..., Awaitable[Any]]):
        self._service_id = service_id
        self._rpc = rpc

    def __getattr__(self, method_name: str) -> RemoteMethod:
        return RemoteMethod(self._service_id, method_name, self._rpc)


class ServiceContainer:
    """注入服务容器（对齐 TS PluginServices：get/has/list）"""

    def __init__(self, rpc: Callable[..., Awaitable[Any]]):
        self._rpc = rpc
        self._injected: Dict[str, ServiceProxy] = {}

    def set(self, service_id: str) -> None:
        """登记已注入服务（runner 侧按 manifest 白名单注入）"""
        self._injected[service_id] = ServiceProxy(service_id, self._rpc)

    def get(self, service_id: str) -> Optional[ServiceProxy]:
        return self._injected.get(service_id)

    def has(self, service_id: str) -> bool:
        return service_id in self._injected

    def list(self) -> List[str]:
        return list(self._injected.keys())


# ---------------------------------------------------------------------------
# 上下文
# ---------------------------------------------------------------------------


@dataclass
class PluginContext:
    """对齐 TS PluginContext：sessionId/logger/services/config/events"""

    plugin_id: str
    plugin_name: str
    version: str
    session_id: Optional[str] = None
    services: Optional[ServiceContainer] = None
    log: Any = None
    config: Any = None
    events: Any = None

    # -- 便捷访问 ----------------------------------------------------------
    @property
    def logger(self) -> Any:
        return self.log


class _Config:
    """跨进程配置（get/set/save → RPC）"""

    def __init__(self, rpc: Callable[..., Awaitable[Any]]):
        self._rpc = rpc
        self._cache: Dict[str, Any] = {}

    async def get(self, key: str, default: Any = None) -> Any:
        if key in self._cache:
            return self._cache[key]
        result = await self._rpc("getConfig", {"key": key})
        value = result if result is not None else default
        self._cache[key] = value
        return value

    async def set(self, key: str, value: Any) -> None:
        self._cache[key] = value
        await self._rpc("setConfig", {"key": key, "value": value})

    async def save(self) -> None:
        await self._rpc("saveConfig", {})


class _Events:
    """跨进程事件（on/off/emit → RPC）"""

    def __init__(self, rpc: Callable[..., Awaitable[Any]]):
        self._rpc = rpc

    async def on(self, event: str) -> None:
        await self._rpc("subscribeEvent", {"event": event})

    async def off(self, event: str) -> None:
        await self._rpc("unsubscribeEvent", {"event": event})

    async def emit(self, event: str, *args: Any, **kwargs: Any) -> None:
        await self._rpc("emitEvent", {"event": event, "args": list(args), "kwargs": kwargs})


class _Logger:
    """跨进程日志（走 stderr，避免污染 stdout 协议帧）"""

    def __init__(self) -> None:
        # Windows 兼容：stderr 强制 UTF-8
        try:
            sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass

    def _write(self, level: str, message: str, *args: Any) -> None:
        if args:
            message = message % args if isinstance(message, str) else str(message)
        print(f"[{level}] {message}", file=sys.stderr, flush=True)

    def debug(self, message: str, *args: Any) -> None:
        self._write("DEBUG", message, *args)

    def info(self, message: str, *args: Any) -> None:
        self._write("INFO", message, *args)

    def warn(self, message: str, *args: Any) -> None:
        self._write("WARN", message, *args)

    def error(self, message: str, *args: Any) -> None:
        self._write("ERROR", message, *args)


# ---------------------------------------------------------------------------
# Plugin
# ---------------------------------------------------------------------------


class Plugin:
    """对齐 TS createPlugin 返回的插件定义"""

    def __init__(
        self,
        id: str,
        name: str,
        version: str,
        tools: Optional[List[ToolRegistration]] = None,
        skills: Optional[List[SkillDefinition]] = None,
        inject: Optional[List[str]] = None,
        injectOptional: Optional[List[str]] = None,
    ):
        self.id = id
        self.name = name
        self.version = version
        self.tools = tools or []
        self.skills = skills or []
        self.inject = inject or []
        self.injectOptional = injectOptional or []

    def run(self) -> None:
        """入口：启动 JSON-RPC 主循环（asyncio，callTool/health 可并发）"""
        from .runner import run_plugin

        run_plugin(self)
