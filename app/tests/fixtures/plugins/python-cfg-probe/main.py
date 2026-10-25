"""E2E 夹具（T25-08 · config 收敛）：经反向 RPC 读写宿主侧配置。

不依赖第三方包；由 `PythonPluginAdapter` 以 `python main.py` 启动。
工具 `cfg_probe` 做三件事：读 `theme` → 写 `theme`/`lang` → `save()`。
"""

from liri.plugin import Plugin, tool


@tool(name="cfg_probe", description="读一次配置，再写两个键并保存")
async def cfg_probe(ctx=None):
    before = await ctx.config.get("theme")
    await ctx.config.set("theme", "dark")
    await ctx.config.set("lang", "zh")
    await ctx.config.save()
    after = await ctx.config.get("theme")
    return {"before": before, "after": after}


plugin = Plugin(
    id="py-cfg-probe",
    name="py-cfg-probe",
    version="1.0.0",
    tools=[cfg_probe],
)

if __name__ == "__main__":
    plugin.run()
