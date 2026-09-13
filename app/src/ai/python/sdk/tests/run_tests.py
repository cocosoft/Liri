"""liri SDK 测试运行器（PY-2，无框架依赖：python sdk/tests/run_tests.py）"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

SDK_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SDK_DIR))

from liri import Plugin, tool, skill, tool_ok, tool_fail  # noqa: E402
from liri.schema import schema_from_callable  # noqa: E402
from liri.plugin import ToolRegistration, SkillDefinition  # noqa: E402

PASS = 0
FAIL = 0


def check(name, fn):
    global PASS, FAIL
    try:
        fn()
        PASS += 1
        print(f"  PASS  {name}")
    except Exception as exc:  # noqa: BLE001
        FAIL += 1
        print(f"  FAIL  {name}: {exc}")


# --------------------------------------------------------------------------- schema
def test_schema():
    def fn(name: str, count: int, flag: bool = False) -> str:
        return name

    props = schema_from_callable(fn, param_descriptions={"name": "称呼"})
    assert props["name"]["type"] == "string"
    assert props["name"]["description"] == "称呼"
    assert props["name"]["required"] is True
    assert props["count"]["type"] == "integer"
    assert props["flag"]["default"] is False
    assert "required" not in props["flag"]


def test_schema_ctx_excluded():
    def fn(name: str, ctx=None) -> str:
        return name

    props = schema_from_callable(fn)
    assert "ctx" not in props


# --------------------------------------------------------------------------- decorators
def test_tool_decorator():
    @tool(name="greet", description="向用户打招呼", params={"name": "称呼"})
    async def greet(name: str) -> str:
        return f"Hello, {name}"

    assert isinstance(greet, ToolRegistration)
    assert greet.parameters["name"]["description"] == "称呼"

    import asyncio

    result = asyncio.run(greet.execute({"name": "liri"}))
    assert result == "Hello, liri"


def test_tool_result_contract():
    """工具显式失败契约（对齐 TS plugin-sdk PluginToolResult）"""
    assert tool_ok({"a": 1}) == {"success": True, "data": {"a": 1}}
    assert tool_ok() == {"success": True, "data": None}
    assert tool_fail("boom") == {"success": False, "error": "boom"}

    @tool(name="failing")
    async def failing() -> dict:
        return tool_fail("boom")

    import asyncio

    assert asyncio.run(failing.execute({})) == {
        "success": False,
        "error": "boom",
    }


def test_skill_decorator():
    @skill(id="summarize", name="摘要", description="总结文本")
    def summarize(text: str) -> str:
        return f"sum:{text}"

    assert isinstance(summarize, SkillDefinition)
    assert summarize.parameters["text"]["type"] == "string"


def test_plugin_collects():
    @tool(name="greet")
    async def greet(name: str) -> str:
        return name

    p = Plugin(id="hello-python", name="Hello Python", version="0.1.0", tools=[greet], inject=["session_manager"])
    assert p.id == "hello-python"
    assert [t.name for t in p.tools] == ["greet"]
    assert p.inject == ["session_manager"]


# --------------------------------------------------------------------------- runner 子进程
PLUGIN_SCRIPT = r"""
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


def spawn_plugin():
    script_path = Path(__file__).parent / "_fixture_plugin.py"
    script_path.write_text(PLUGIN_SCRIPT.format(sdk_dir=str(SDK_DIR).replace("\\", "\\\\")), encoding="utf-8")
    proc = subprocess.Popen(
        [sys.executable, str(script_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(SDK_DIR),
        text=True,
        encoding="utf-8",
        bufsize=1,
    )
    return proc, script_path


def read_line(proc, timeout=10):
    """从子进程 stdout 读一行 JSON（线程 + queue 实现超时，兼容 Windows 非 socket）"""
    import queue
    import threading

    q: "queue.Queue[str]" = queue.Queue()

    def _read():
        try:
            q.put(proc.stdout.readline())
        except Exception:  # noqa: BLE001
            q.put("")

    t = threading.Thread(target=_read, daemon=True)
    t.start()
    try:
        line = q.get(timeout=timeout)
    except queue.Empty:
        raise TimeoutError("timed out waiting for worker output")
    if not line:
        raise TimeoutError("worker stdout closed")
    return json.loads(line)


def write(proc, obj):
    proc.stdin.write(json.dumps(obj) + "\n")
    proc.stdin.flush()


def test_runner_handshake():
    proc, script = spawn_plugin()
    try:
        startup = read_line(proc)
        assert startup["type"] == "startup"

        write(proc, {"id": "r1", "method": "initialize", "params": {"sessionId": "s1"}})
        init = read_line(proc)
        assert init["success"] is True
        assert init["result"]["protocolVersion"] == 1
        assert init["result"]["plugin"]["id"] == "hello-python"

        write(proc, {"id": "r2", "method": "listTools", "params": {}})
        tools = read_line(proc)
        assert tools["result"][0]["name"] == "greet"
        assert tools["result"][0]["parameters"]["name"]["required"] is True

        write(proc, {"id": "r3", "method": "callTool", "params": {"name": "greet", "args": {"name": "liri"}}})
        call = read_line(proc)
        assert call["result"] == "Hello, liri"

        write(proc, {"id": "r4", "method": "listSkills", "params": {}})
        skills = read_line(proc)
        assert skills["result"][0]["id"] == "echo"

        write(proc, {"id": "r5", "method": "executeSkill", "params": {"id": "echo", "args": {"text": "hi"}}})
        skill_result = read_line(proc)
        assert skill_result["result"] == "hi"

        write(proc, {"id": "r6", "method": "health", "params": {}})
        health = read_line(proc)
        assert health["result"]["status"] == "ok"

        write(proc, {"id": "r7", "method": "shutdown", "params": {}})
        bye = read_line(proc)
        assert bye["success"] is True
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        script.unlink(missing_ok=True)


def test_runner_unknown_method():
    proc, script = spawn_plugin()
    try:
        read_line(proc)
        write(proc, {"id": "r1", "method": "nope", "params": {}})
        res = read_line(proc)
        assert res["success"] is False
        assert res["error"]["code"] == "INTERNAL_ERROR"
    finally:
        proc.stdin.close()
        proc.kill()
        script.unlink(missing_ok=True)


def test_runner_concurrent_health():
    """长任务 callTool 执行期间 health 能及时返回（不误杀）"""
    proc, script = spawn_plugin()
    try:
        read_line(proc)
        write(proc, {"id": "r1", "method": "callTool", "params": {"name": "slow_task", "args": {}}})
        time.sleep(0.2)
        start = time.time()
        write(proc, {"id": "r2", "method": "health", "params": {}})
        health = read_line(proc, timeout=3)
        elapsed = time.time() - start
        assert health["result"]["status"] == "ok"
        assert elapsed < 0.8, f"health 被长任务阻塞: {elapsed:.2f}s"
        slow = read_line(proc, timeout=5)
        assert slow["result"] == "slow done"
    finally:
        proc.stdin.close()
        proc.kill()
        script.unlink(missing_ok=True)


def main():
    print("liri SDK tests (PY-2)")
    check("schema_from_callable 基础映射", test_schema)
    check("schema ctx 参数排除", test_schema_ctx_excluded)
    check("@tool 装饰器生成 ToolRegistration 并可执行", test_tool_decorator)
    check("工具显式失败契约（tool_ok / tool_fail）", test_tool_result_contract)
    check("@skill 装饰器生成 SkillDefinition", test_skill_decorator)
    check("Plugin 收集注册项", test_plugin_collects)
    check("runner 子进程握手闭环", test_runner_handshake)
    check("runner 未知方法错误序列化", test_runner_unknown_method)
    check("runner 长任务与 health 并发", test_runner_concurrent_health)
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
