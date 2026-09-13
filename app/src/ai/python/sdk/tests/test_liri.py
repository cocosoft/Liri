"""liri SDK 测试（PY-2）：schema / 装饰器 / Plugin / runner 子进程闭环"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from liri import Plugin, tool, skill  # noqa: E402
from liri.schema import schema_from_callable  # noqa: E402
from liri.plugin import ToolRegistration, SkillDefinition  # noqa: E402

SDK_DIR = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# schema：type hints → JSON Schema
# ---------------------------------------------------------------------------


def test_schema_from_callable_basic():
    def fn(name: str, count: int, flag: bool = False) -> str:
        return name

    props = schema_from_callable(fn, param_descriptions={"name": "称呼"})
    assert props["name"]["type"] == "string"
    assert props["name"]["description"] == "称呼"
    assert props["name"]["required"] is True
    assert props["count"]["type"] == "integer"
    assert props["count"]["required"] is True
    assert props["flag"]["type"] == "boolean"
    assert "required" not in props["flag"]  # 有默认值非必填
    assert props["flag"]["default"] is False


def test_schema_ctx_param_excluded():
    def fn(name: str, ctx=None) -> str:
        return name

    props = schema_from_callable(fn)
    assert "ctx" not in props
    assert props["name"]["type"] == "string"


# ---------------------------------------------------------------------------
# 装饰器
# ---------------------------------------------------------------------------


def test_tool_decorator():
    @tool(name="greet", description="向用户打招呼", params={"name": "称呼"})
    async def greet(name: str) -> str:
        return f"Hello, {name}"

    assert isinstance(greet, ToolRegistration)
    assert greet.name == "greet"
    assert greet.description == "向用户打招呼"
    assert greet.parameters["name"]["description"] == "称呼"

    result = greet.execute({"name": "liri"})
    assert result.__class__.__name__ == "coroutine"
    assert asyncio_run(result) == "Hello, liri"


def test_skill_decorator():
    @skill(id="summarize", name="摘要", description="总结文本")
    def summarize(text: str) -> str:
        return f"sum:{text}"

    assert isinstance(summarize, SkillDefinition)
    assert summarize.id == "summarize"
    assert summarize.parameters["text"]["type"] == "string"


def test_plugin_collects_registrations():
    @tool(name="greet")
    async def greet(name: str) -> str:
        return name

    @skill(id="s1")
    async def s1(text: str) -> str:
        return text

    p = Plugin(
        id="hello-python",
        name="Hello Python",
        version="0.1.0",
        tools=[greet],
        skills=[s1],
        inject=["session_manager"],
    )
    assert p.id == "hello-python"
    assert [t.name for t in p.tools] == ["greet"]
    assert [s.id for s in p.skills] == ["s1"]
    assert p.inject == ["session_manager"]


def asyncio_run(coro):
    import asyncio

    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# runner：子进程 JSON-RPC 闭环
# ---------------------------------------------------------------------------

PLUGIN_SCRIPT = r"""
import asyncio
import sys
import time

sys.path.insert(0, r"{sdk_dir}")

from liri import Plugin, tool, skill


@tool(name="greet", description="向用户打招呼", params={{"name": "称呼"}})
async def greet(name: str, ctx=None) -> str:
    return f"Hello, {{name}}"


@tool(name="slow_task", description="阻塞 1s 的长任务")
async def slow_task(ctx=None) -> str:
    time.sleep(1)
    return "slow done"


@skill(id="echo", name="回显", description="回显文本")
async def echo(text: str) -> str:
    return text


plugin = Plugin(
    id="hello-python",
    name="Hello Python",
    version="0.1.0",
    tools=[greet, slow_task],
    skills=[echo],
    inject=["session_manager"],
)
plugin.run()
"""


@pytest.fixture
def plugin_proc():
    script_path = Path(__file__).parent / "_fixture_plugin.py"
    script_path.write_text(
        PLUGIN_SCRIPT.format(sdk_dir=str(SDK_DIR).replace("\\", "\\\\")),
        encoding="utf-8",
    )
    proc = subprocess.Popen(
        [sys.executable, str(script_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(SDK_DIR),
        text=True,
        encoding="utf-8",
    )
    yield proc
    if proc.poll() is None:
        proc.kill()
    script_path.unlink(missing_ok=True)


def _read_line(proc, timeout=10):
    """从子进程 stdout 读一行 JSON（线程 + queue 实现超时，兼容 Windows 非 socket）"""
    import queue
    import threading

    q = queue.Queue()

    def _read():
        try:
            q.put(proc.stdout.readline())
        except Exception:
            q.put("")

    threading.Thread(target=_read, daemon=True).start()
    try:
        line = q.get(timeout=timeout)
    except queue.Empty:
        raise TimeoutError("timed out waiting for worker output")
    if not line:
        raise TimeoutError("worker stdout closed")
    return json.loads(line)


def _write(proc, obj):
    proc.stdin.write(json.dumps(obj) + "\n")
    proc.stdin.flush()


def test_runner_full_handshake(plugin_proc):
    proc = plugin_proc

    # 1. startup
    startup = _read_line(proc)
    assert startup["type"] == "startup"

    # 2. initialize
    _write(proc, {"id": "r1", "method": "initialize", "params": {"sessionId": "s1"}})
    init = _read_line(proc)
    assert init["success"] is True
    assert init["result"]["protocolVersion"] == 1
    assert init["result"]["plugin"]["id"] == "hello-python"

    # 3. listTools
    _write(proc, {"id": "r2", "method": "listTools", "params": {}})
    tools = _read_line(proc)
    assert tools["success"] is True
    assert tools["result"][0]["name"] == "greet"
    assert tools["result"][0]["parameters"]["name"]["required"] is True

    # 4. callTool
    _write(proc, {"id": "r3", "method": "callTool", "params": {"name": "greet", "args": {"name": "liri"}}})
    call = _read_line(proc)
    assert call["success"] is True
    assert call["result"] == "Hello, liri"

    # 5. listSkills / executeSkill
    _write(proc, {"id": "r4", "method": "listSkills", "params": {}})
    skills = _read_line(proc)
    assert skills["result"][0]["id"] == "echo"

    _write(proc, {"id": "r5", "method": "executeSkill", "params": {"id": "echo", "args": {"text": "hi"}}})
    skill_result = _read_line(proc)
    assert skill_result["result"] == "hi"

    # 6. health 并发可用
    _write(proc, {"id": "r6", "method": "health", "params": {}})
    health = _read_line(proc)
    assert health["result"]["status"] == "ok"

    # 7. shutdown
    _write(proc, {"id": "r7", "method": "shutdown", "params": {}})
    bye = _read_line(proc)
    assert bye["success"] is True

    # 进程退出
    proc.stdin.close()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def test_runner_unknown_method_error(plugin_proc):
    proc = plugin_proc
    _read_line(proc)  # startup

    _write(proc, {"id": "r1", "method": "nope", "params": {}})
    res = _read_line(proc)
    assert res["success"] is False
    assert res["error"]["code"] == "INTERNAL_ERROR"


def test_runner_call_tool_concurrent_with_health(plugin_proc):
    """长任务 callTool 执行期间 health 能及时返回（并发，不误杀）"""
    proc = plugin_proc
    _read_line(proc)  # startup

    # 发起慢任务（线程池执行 1s）
    _write(proc, {"id": "r1", "method": "callTool", "params": {"name": "slow_task", "args": {}}})
    time.sleep(0.2)

    # 慢任务执行期间 health 应快速返回（< 1s）
    start = time.time()
    _write(proc, {"id": "r2", "method": "health", "params": {}})
    health = _read_line(proc, timeout=3)
    elapsed = time.time() - start
    assert health["success"] is True
    assert health["result"]["status"] == "ok"
    assert elapsed < 0.8, f"health 被长任务阻塞: {elapsed:.2f}s"

    # 慢任务最终完成
    slow = _read_line(proc, timeout=5)
    assert slow["result"] == "slow done"
