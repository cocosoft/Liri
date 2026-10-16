/**
 * 门禁：**新数据源不以新增工具承载**（工具治理方案 §5 阶段 3.2 / T1-12-3.2，2026-10-13）。
 *
 * 语义（对齐 D4/D7 的 VFS 收口裁决）：新数据源应**从既有工具面收口** —— 挂到 VFS
 * （`read_vfs`/`list_vfs`/`stat_vfs`/`write_vfs`）或走 MCP（`${server}__${tool}`）——
 * 而不是"每来一个数据源就新增一个内置工具"。本守卫把该约定落为**可失败门禁**：
 * 凡进入**声明面**（`TOOL_NAME_CONSTANTS`，D11-B 工具名唯一来源）的**新**工具名，必须在下方
 * **显式豁免清单 `NEW_TOOL_REGISTRY`** 登记"为何不能挂载 VFS / 走 MCP"的**理由**；缺失即失败
 * （fail-closed，对照 R09-006 状态机登记门禁）。
 *
 * 做法对齐 `tests/channels/channelTruncationGuard.test.ts` / `tests/state/stateMachineHygiene.test.ts`
 * 的源码守卫风格，并复用 `tests/tools/toolNameLists.test.ts` 的"判据来自真实代码而非手写清单"思路。
 *
 * 判据（全部来自真实代码，避免"会随版本漂移的手写清单"而无出处）：
 *   - 声明面（事实源）= `TOOL_NAME_CONSTANTS`（工具类 / loader / 门禁共用，含 flag-gated 名）；
 *   - **基线快照** `FROZEN_TOOL_BASELINE` = 门禁生效时的既有工具名（出处见其注释；**冻结**，
 *     不随代码自动更新 —— 这正是"新增即需登记"的比较基准）；
 *   - 新增 = 声明面 − 基线；新增必须 ∈ `NEW_TOOL_REGISTRY`（键 = 工具名，值 = 理由）；
 *   - `NEW_TOOL_REGISTRY` 与基线**不重叠**；基线不得残留"声明面已不存在"的名（防陈旧）。
 *
 * 注：命名空间工具族（`office:*` / `calendar:*` / `workflow:*` …）的新增由
 * `toolNameLists.test.ts` 的 **G6「运行期注册族快照」** 另行拦截；本门禁只覆盖声明面（内置工具名）。
 */
import { describe, expect, it } from 'bun:test';
import { TOOL_NAME_CONSTANTS } from '../../src/tools/toolNameConstants';

/**
 * **冻结基线**（出处：`src/tools/toolNameConstants.ts` 的 `TOOL_NAME_CONSTANTS`，
 * 2026-10-13 冻结，共 90 项；2026-10-16 `propose_plan` 下线后为 **89 项**）。
 * ⚠️ 这是**快照**，不是"实时清单"：新增工具**不得**改这里，
 * 而应在 `NEW_TOOL_REGISTRY` 登记理由（见文件头判据）。
 * 例外：**移除**工具时须同步删基线项 —— 否则会被下方"基线不陈旧"用例判红（设计如此）。
 */
const FROZEN_TOOL_BASELINE: readonly string[] = [
  'agent',
  'agents_list',
  'ask_user_question',
  'audio_play',
  'bash',
  'brief',
  'broadcast',
  'browser',
  'browser_vision',
  'canvas',
  'channel',
  'clipboard',
  'code_run',
  'computer_use',
  'config',
  'create_project',
  'create_task_list',
  'cron_create',
  'cron_delete',
  'cron_list',
  'cron_stop',
  'doc_generate',
  'enter_worktree',
  'exit_worktree',
  'file_convert',
  'file_edit',
  'file_read',
  'file_write',
  'get_task_list',
  'glob',
  'grep',
  'image',
  'image_analysis',
  'image_display',
  'image_generate',
  'image_svg_generate',
  'kanban',
  'knowledge_save',
  'list_peers',
  'list_vfs',
  'lsp',
  'mcp_auth',
  'mcp_resource',
  'mcp_tool',
  'monitor',
  'music',
  'music_generate',
  'nodes',
  'notebook',
  'pdf',
  'plan',
  'powershell',
  'read_project_file',
  'read_vfs',
  'repl',
  'save_conversation',
  'send_message',
  'session_status',
  'sessions',
  'sessions_send',
  'sessions_spawn',
  'sessions_yield',
  'skill',
  'skill_view',
  'skills_list',
  'sleep',
  'sleep_for',
  'sleep_until',
  'stat_vfs',
  'task_output',
  'task_stop',
  'team_create',
  'team_delete',
  'thinking',
  'todo_write',
  'tool_search',
  'trace_recording',
  'tts',
  'tungsten',
  'update_plan',
  'update_task_status',
  'video',
  'video_analysis',
  'video_display',
  'video_generate',
  'web_fetch',
  'web_search',
  'write_project_file',
  'write_vfs',
];

/**
 * **新增工具豁免清单**（键 = 工具名；值 = 非空**理由**）。
 *
 * 语义：基线之后新增的每个声明工具名都必须在此登记 —— 写明**为何不能挂载 VFS / 走 MCP**。
 * 例：`{ mysql_query: '新数据源 MySQL；MCP 侧已有通用 client，直接挂 MCP 更合适（此处暂列待迁移）' }`。
 * ⚠️ 该清单当前为**空**（截至 2026-10-13 无基线后新增工具）。空 ≠ 可忽略：一旦清空机制被绕过，
 * 主门禁用例会立即失败。禁止为"抄进清单但未注册"的名字登记 —— 与 `toolNameLists.test.ts` 同口径。
 */
const NEW_TOOL_REGISTRY: Readonly<Record<string, string>> = {};

/** 判据（纯函数，供真实门禁与**负向自证**共用）：返回"非基线且未登记理由"的新工具名 */
function findUnregisteredNewTools(
  declared: Iterable<string>,
  baseline: ReadonlySet<string>,
  registry: Readonly<Record<string, string>>
): string[] {
  const registered = new Set(Object.keys(registry));
  return [...declared]
    .filter((name) => !baseline.has(name) && !registered.has(name))
    .sort();
}

const DECLARED = Object.values(TOOL_NAME_CONSTANTS);
const BASELINE = new Set(FROZEN_TOOL_BASELINE);

describe('门禁：新数据源不以新增工具承载（阶段 3.2）', () => {
  it('扫描面非空且关键工具在基线内（防空转导致守卫恒真）', () => {
    expect(DECLARED.length).toBeGreaterThan(50);
    for (const must of [
      'file_read',
      'file_write',
      'write_vfs',
      'read_vfs',
      'bash',
      'grep',
    ]) {
      expect({ tool: must, inBaseline: BASELINE.has(must) }).toEqual({
        tool: must,
        inBaseline: true,
      });
    }
  });

  it('主门禁：声明面中的**新**工具名必须在豁免清单登记理由（缺失即失败）', () => {
    const unregistered = findUnregisteredNewTools(
      DECLARED,
      BASELINE,
      NEW_TOOL_REGISTRY
    );
    // 失败信息即"该如何处置"：把名字加入 NEW_TOOL_REGISTRY 并写明理由，
    // 或（若确应从既有工具面收口）改走 VFS/MCP 而不新增工具。
    expect(unregistered).toEqual([]);
  });

  it('基线不陈旧：基线中的每个名字仍存在于声明面（改名/移除须同步基线）', () => {
    const declared = new Set<string>(DECLARED);
    const stale = [...BASELINE].filter((n) => !declared.has(n)).sort();
    expect(stale).toEqual([]);
  });

  it('豁免清单：每条登记都必须带**非空理由**（"显式且附理由" = 阶段 3.2 验收口径）', () => {
    for (const [name, reason] of Object.entries(NEW_TOOL_REGISTRY)) {
      expect({ name, hasReason: reason.trim().length > 0 }).toEqual({
        name,
        hasReason: true,
      });
    }
  });

  it('豁免清单与基线**不重叠**（同一工具名只能有一处登记）', () => {
    const overlapped = Object.keys(NEW_TOOL_REGISTRY)
      .filter((n) => BASELINE.has(n))
      .sort();
    expect(overlapped).toEqual([]);
  });

  it('门禁自证（负向夹具）：注入探针新增工具 ⇒ 判违规 ⇒ 非恒真', () => {
    // ① 未登记 ⇒ 被捕获（证明门禁能对"新出现的工具名"给出显式拦截）
    const probe = [...DECLARED, 'mysql_query'];
    expect(findUnregisteredNewTools(probe, BASELINE, {})).toEqual([
      'mysql_query',
    ]);
    // ② 登记理由后 ⇒ 放行（证明拦截基于"是否登记"，而非无差别恒真）
    expect(
      findUnregisteredNewTools(probe, BASELINE, {
        mysql_query: '挂 MCP generic client 评估中（临时登记）',
      })
    ).toEqual([]);
  });
});
