"""plugin.run() JSON-RPC 主循环（PY-2）

对齐 JsonRpcBridge 协议（行分隔 JSON）：
- 启动发 {"type":"startup","pid":...}
- 处理主进程请求：initialize / listTools / callTool / listSkills / executeSkill /
  getConfig / setConfig / saveConfig / subscribeEvent / unsubscribeEvent / emitEvent / health / shutdown
- 主进程→子进程通知：{"type":"notify",...}
- 关闭：协议 shutdown 帧 或 "__SHUTDOWN__" 裸行
- 反向 RPC：子进程发起（服务代理 injectService 调用）→ 主进程回响应

并发：请求在独立任务/线程处理（callTool 长任务不阻塞 health）；stdout 写加锁防交错。
"""
import asyncio
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional

from .plugin import Plugin, PluginContext, ServiceContainer, _Config, _Events, _Logger
from .version import PROTOCOL_VERSION


class PluginJsonRpcServer:
    def __init__(self, plugin: Plugin):
        self.plugin = plugin
        self._stdout_lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=8)
        # 反向 RPC（子进程发起请求后等待主进程响应）
        # 线程安全：executor 线程 await（新事件循环）+ 主循环线程收到响应 set event
        self._reverse_events: Dict[str, threading.Event] = {}
        self._reverse_results: Dict[str, Dict[str, Any]] = {}
        self._reverse_lock = threading.Lock()
        self._next_request_id = 0
        self._ctx: Optional[PluginContext] = None
        self._running = False

    # ------------------------------------------------------------------ 协议 I/O
    def _send(self, obj: Dict[str, Any]) -> None:
        """写 stdout（加锁，防止多任务并发写交错半个 JSON 行）"""
        with self._stdout_lock:
            sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
            sys.stdout.flush()

    async def _reverse_rpc(self, method: str, params: Dict[str, Any]) -> Any:
        """子进程 → 主进程 请求（服务代理/事件用），等主进程响应（线程安全）"""
        if not self._running:
            raise RuntimeError("worker 尚未就绪")
        with self._reverse_lock:
            self._next_request_id += 1
            req_id = f"py_req_{self._next_request_id}"
            event = threading.Event()
            self._reverse_events[req_id] = event
        self._send({"id": req_id, "method": method, "params": params, "fromChild": True})
        # 主循环线程（_dispatch）收到响应后 set event；这里在任意线程等待
        await asyncio.to_thread(event.wait, 30)
        with self._reverse_lock:
            self._reverse_events.pop(req_id, None)
            result = self._reverse_results.pop(req_id, None)
        if result is None:
            raise RuntimeError(f"反向 RPC {method} 超时或未响应")
        if not result.get("success"):
            raise RuntimeError(result.get("error", {}).get("message", "RPC failed"))
        return result.get("result")

    # ------------------------------------------------------------------ 主循环
    def run(self) -> None:
        self._running = True
        self._send({"type": "startup", "pid": os.getpid()})
        try:
            asyncio.run(self._main())
        finally:
            self._executor.shutdown(wait=False, cancel_futures=True)
            self._running = False

    async def _main(self) -> None:
        loop = asyncio.get_event_loop()
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break  # stdin 关闭
            line = line.strip()
            if not line:
                continue
            if line == "__SHUTDOWN__":
                break
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            await self._dispatch(msg)

    async def _dispatch(self, msg: Dict[str, Any]) -> None:
        # 主进程 → 子进程 通知帧（无 id）
        if msg.get("type") == "notify" and "id" not in msg:
            self._on_notify(msg)
            return
        # 反向 RPC 响应（主进程回复子进程请求）
        if "id" in msg:
            with self._reverse_lock:
                event = self._reverse_events.get(msg["id"])
                if event is not None:
                    self._reverse_results[msg["id"]] = msg
                    event.set()
                    return
        # 主进程 → 子进程 请求（带 id）
        if "id" in msg:
            asyncio.create_task(self._handle_request(msg))

    def _on_notify(self, msg: Dict[str, Any]) -> None:
        # 首版：插件可覆盖 _on_event 扩展；默认仅记录
        event = msg.get("event", "unknown")
        if self._ctx and self._ctx.log:
            self._ctx.log.debug(f"[notify] {event} {msg.get('data')}")

    async def _handle_request(self, msg: Dict[str, Any]) -> None:
        method = msg.get("method", "")
        params = msg.get("params") or {}
        req_id = msg.get("id")
        try:
            result = await self._call_method(method, params)
            self._send({"id": req_id, "success": True, "result": result})
        except Exception as exc:  # noqa: BLE001 — 协议层兜底序列化
            self._send({
                "id": req_id,
                "success": False,
                "error": {"code": "INTERNAL_ERROR", "message": str(exc)},
                "errorCode": "INTERNAL_ERROR",
            })

    async def _call_method(self, method: str, params: Dict[str, Any]) -> Any:
        handler = getattr(self, f"_method_{method}", None)
        if handler is None:
            raise RuntimeError(f"Unknown method: {method}")
        return await handler(params)

    # ------------------------------------------------------------------ 上下文
    def _ensure_context(self) -> PluginContext:
        if self._ctx is None:
            rpc = self._reverse_rpc
            services = ServiceContainer(rpc)
            for sid in self.plugin.inject:
                services.set(sid)
            self._ctx = PluginContext(
                plugin_id=self.plugin.id,
                plugin_name=self.plugin.name,
                version=self.plugin.version,
                services=services,
                log=_Logger(),
                config=_Config(rpc),
                events=_Events(rpc),
            )
        return self._ctx

    # ------------------------------------------------------------------ 协议方法
    async def _method_initialize(self, params: Dict[str, Any]) -> Dict[str, Any]:
        ctx = self._ensure_context()
        if "sessionId" in params:
            ctx.session_id = params["sessionId"]
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "plugin": {
                "id": self.plugin.id,
                "name": self.plugin.name,
                "version": self.plugin.version,
                "inject": self.plugin.inject,
                "injectOptional": self.plugin.injectOptional,
            },
        }

    async def _method_listTools(self, params: Dict[str, Any]) -> list:
        return [
            {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            }
            for t in self.plugin.tools
        ]

    async def _method_callTool(self, params: Dict[str, Any]) -> Any:
        name = params.get("name", "")
        args = params.get("args") or {}
        tool = next((t for t in self.plugin.tools if t.name == name), None)
        if tool is None:
            raise RuntimeError(f"Tool not found: {name}")
        # 线程池执行：同步阻塞的插件函数不阻塞事件循环（health 可并发响应）
        ctx = self._ensure_context()
        return await asyncio.get_event_loop().run_in_executor(
            None, lambda: asyncio.run(tool.execute({**args, "ctx": ctx}))
        )

    async def _method_listSkills(self, params: Dict[str, Any]) -> list:
        return [
            {
                "id": s.id,
                "name": s.name,
                "description": s.description,
                "parameters": s.parameters,
            }
            for s in self.plugin.skills
        ]

    async def _method_executeSkill(self, params: Dict[str, Any]) -> Any:
        skill_id = params.get("id", "")
        args = params.get("args") or {}
        skill = next((s for s in self.plugin.skills if s.id == skill_id), None)
        if skill is None:
            raise RuntimeError(f"Skill not found: {skill_id}")
        ctx = self._ensure_context()
        return await asyncio.get_event_loop().run_in_executor(
            None, lambda: asyncio.run(skill.execute({**args, "ctx": ctx}))
        )

    async def _method_health(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return {"status": "ok"}

    async def _method_shutdown(self, params: Dict[str, Any]) -> Dict[str, Any]:
        self._running = False
        asyncio.get_event_loop().stop()
        return {"status": "bye"}

    # 服务代理（子进程 → 主进程请求，经 _reverse_rpc 转发）
    async def _method_injectService(self, params: Dict[str, Any]) -> Any:
        # 插件侧 ServiceProxy.RemoteMethod 直接走 _reverse_rpc("injectService", ...)，
        # 此处仅为协议完整性占位（真实转发在主进程 PythonPluginAdapter 处理）
        raise RuntimeError("injectService 应由主进程侧 PythonPluginAdapter 执行")

    # 配置 / 事件（Python 侧代理经 _reverse_rpc 发起）
    async def _method_getConfig(self, params: Dict[str, Any]) -> Any:
        raise RuntimeError("getConfig 应由主进程侧实现")

    async def _method_setConfig(self, params: Dict[str, Any]) -> None:
        raise RuntimeError("setConfig 应由主进程侧实现")

    async def _method_saveConfig(self, params: Dict[str, Any]) -> None:
        raise RuntimeError("saveConfig 应由主进程侧实现")

    async def _method_subscribeEvent(self, params: Dict[str, Any]) -> None:
        raise RuntimeError("subscribeEvent 应由主进程侧实现")

    async def _method_unsubscribeEvent(self, params: Dict[str, Any]) -> None:
        raise RuntimeError("unsubscribeEvent 应由主进程侧实现")

    async def _method_emitEvent(self, params: Dict[str, Any]) -> None:
        raise RuntimeError("emitEvent 应由主进程侧实现")


def run_plugin(plugin: Plugin) -> None:
    """插件入口：启动 JSON-RPC 主循环（main:plugin 脚本风格调用）"""
    PluginJsonRpcServer(plugin).run()
