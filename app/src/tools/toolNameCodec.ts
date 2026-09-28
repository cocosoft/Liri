/**
 * 工具名 wire codec（V-17 后续，2026-09-14；2026-09-27 从 `06f4384b4` 移植回 main）
 *
 * 背景：工具名存在**两种语义**，此前被混用。
 *  - **内部标识**：`模块:动作` 命名空间（如 `calendar:add`）——用于归属、检索与策略匹配
 *    （`EXTERNAL_ACTION_TOOLS` / `TOOL_CATEGORIES` / `allowedTools` 均按此书写）。
 *  - **wire 格式**：OpenAI 兼容 `tools[].function.name` 只接受 `^[a-zA-Z0-9_-]+$`，
 *    **不含冒号**。把内部标识原样写入 wire 字段 ⇒ provider 参数校验直接 400
 *    （`Invalid 'tools[N].function.name': string does not match pattern`），整轮对话失败。
 *
 * 故：**出站**（构造 `ToolDefinition`）用 `toWireToolName()` 转安全名；
 *     **入站**（模型回传的工具名）经 `ToolRegistry.resolveRegisteredName()` 回真名。
 *
 * ⚠️ 回归警示（2026-09-27 实测）：本文件曾只存在于未合入 main 的提交上，
 * main 长期缺失 ⇒ 冒号工具名原样下发 ⇒ `tools[36].function.name` 400 ⇒
 * 整轮 `chunkCount:0` + 空回复兜底 ⇒ 用户感知「长程任务中断」。
 * 详见 `debug-long-task-interrupt.md` 与 `.trae/specs/tool-name-wire-codec.md`。
 *
 * 与 MCP 归一化的关系：`services/mcp/normalization.ts` 解决的是同一类问题
 * （MCP 工具名含 `/`、`.` 等非法字符，故归一为 `mcp__server__tool`）。本文件服务的是
 * **内建工具的冒号命名空间**，模式常量同为 OpenAI 函数名规范——两者是"同一 wire 约束的
 * 两个来源"，共享同一条正则语义，但归属不同（MCP 协议名 vs OpenAI wire 名），故各自持有
 * 常量而不互相导入（避免 `tools/` 依赖 `services/mcp/` 的语义错配）。
 */

/** OpenAI 兼容 `tools[].function.name` 允许的字符集 */
const WIRE_SAFE_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** 非法字符（不在 wire 允许集内） */
const WIRE_UNSAFE_CHARS = /[^a-zA-Z0-9_-]/g;

/**
 * 工具名是否已是合法 wire 名（可直接下发模型）。
 */
export function isWireSafeToolName(name: string): boolean {
  return WIRE_SAFE_PATTERN.test(name);
}

/**
 * 内部工具名 → wire 安全名（幂等：已是安全名时原样返回）。
 *
 * 例：`calendar:add` → `calendar_add`；`media:image:convert` → `media_image_convert`。
 * 反向由 `ToolRegistry` 的别名解析承担（注册期为非安全名自动登记安全别名）。
 */
export function toWireToolName(name: string): string {
  return isWireSafeToolName(name) ? name : name.replace(WIRE_UNSAFE_CHARS, '_');
}
