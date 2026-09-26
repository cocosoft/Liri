/**
 * 工具名称常量
 *
 * 用途：为**有活消费方**的工具名提供单一来源（消除硬编码字符串）。
 *
 * ⚠️ 2026-09-26 实测驱动的清理（两条）：
 *
 * 1) **修正值**：`file_*` 原为 CC 风格名 `Read` / `Write` / `Edit`，与本仓**真实注册名**不符
 *    （真实名见 `src/tools/**` 的 `name = '...'` 声明、`components/ui/ToolUIRegistry.ts`、以及
 *    评测沙箱 `/v1/tools` 实测）⇒ 其**唯一消费方** `chat/services/ToolExecutionService.ts`
 *    的"是否文件写/改操作"判定**恒不成立** ⇒ **回滚的文件操作前追踪从未触发**（静默失效）。
 *    现值已与运行时一致；防回退守卫见 `tests/tools/toolNameLists.test.ts`。
 *
 * 2) **删除 CC 词汇残留（零消费方）**：原先还导出 `BASH_TOOL_NAME` / `GLOB_TOOL_NAME` /
 *    `GREP_TOOL_NAME` / `WEB_SEARCH|FETCH_TOOL_NAME` / `NOTEBOOK_EDIT_TOOL_NAME` /
 *    `ASK_USER_QUESTION_TOOL_NAME` / `TODO_WRITE_TOOL_NAME` / `TOOL_SEARCH_TOOL_NAME` /
 *    `SKILL_TOOL_NAME` / `AGENT_TOOL_NAME` / `TASK_*_TOOL_NAME` / `SEND_MESSAGE_TOOL_NAME` /
 *    `ENTER|EXIT_PLAN_MODE_TOOL_NAME` / `ENTER|EXIT_WORKTREE_TOOL_NAME` /
 *    `SYNTHETIC_OUTPUT_TOOL_NAME` / `WORKFLOW_TOOL_NAME`，以及 `SHELL_TOOL_NAMES` /
 *    `ALL_AGENT_DISALLOWED_TOOLS` / `CUSTOM_AGENT_DISALLOWED_TOOLS` / `ASYNC_AGENT_ALLOWED_TOOLS` /
 *    `IN_PROCESS_TEAMMATE_ALLOWED_TOOLS` / `COORDINATOR_MODE_ALLOWED_TOOLS`。
 *    **全仓（app / client / scripts）零引用**，且**多数名字在本仓并不存在**
 *    （如 `TaskCreate` vs 真实 `create_task_list`、`WebSearch` vs 真实 `web_search`）
 *    —— 保留它们会被误当成"工具名的事实来源"。
 *    同类零消费清单此前已按 N-29 先例删除过一次（`PROFILE_TOOL_ALLOW_LISTS`）。
 *
 * **需要工具名时的正确来源**：工具类自身的 `name` 字段（`src/tools/**`）或
 * `components/ui/ToolUIRegistry.ts` —— 那才是运行时事实；本文件只登记**已核对过**的少数几个。
 */
export const FILE_READ_TOOL_NAME = 'file_read';
export const FILE_EDIT_TOOL_NAME = 'file_edit';
export const FILE_WRITE_TOOL_NAME = 'file_write';
