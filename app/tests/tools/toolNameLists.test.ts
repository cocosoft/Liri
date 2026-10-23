/**
 * 工具名清单**防漂移守卫**（2026-09-26，P3-2 顺查项③修复的配套）。
 *
 * 背景：本仓多处清单抄的是 **Claude Code（CC）源码的工具名**（`read_file` / `Read` / `Edit` /
 * `search_code` / `list_files` …），而本仓**真实注册名**是 `file_read` / `file_edit` / `file_write` / `glob` / `grep`
 * （另有一类**更隐蔽**的漂移：名字**在工具类里声明**、却**从未被任何 loader 注册** —— 如 `file_search`，
 * 见 2026-09-29 P2-3 的门禁与注释）
 * ⇒ 这些清单**对本仓主要文件工具永不命中**，功能静默失效（微压缩不覆盖文件结果、只读判定恒 false、
 * 注入模型的提示词让模型去调不存在的工具）。
 *
 * 守卫方式（对齐 A7 的"扫描真实代码而非手写清单"思路）：
 *  ① **判据来自真实代码** —— 扫描 `src/tools/**` 的 `name = '...'` 声明得到"真实注册名"集合；
 *  ② 各清单必须 **⊆ 真实名**（防止再抄 CC 名）；
 *  ③ **正向断言**（关键）：清单必须**含**本仓关键文件工具 —— 否则空集也能通过 ② 而不被发现；
 *  ④ 注入模型的提示词里**不得**再出现漂移字面量。
 */
import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { COMPACTABLE_TOOL_NAMES } from '../../src/context/compaction/MicroCompactionEngine';
import { DREAM_READ_ONLY_TOOLS as READ_ONLY_TOOLS } from '../../src/tasks/dream/DreamPhases';
import {
  SAFE_READ_ONLY_TOOLS,
  SPECULATION_WRITE_TOOLS,
} from '../../src/promptSuggestion/types';
// 2026-09-26：`query/tool-constants.ts` 的两个清单原为 CC 名（`read_file`/`write_file`/…），
// 消费方 `FileIOLoopDetector.checkBeforeAccess()` 对本仓主要文件工具恒不命中 ⇒ 读写循环检测静默失效。
// 与上面四处同型，故一并纳入本守卫（别名导入以避开与 `query.tool-constants.WRITE_TOOLS` 重名）。
import {
  READ_TOOLS as QUERY_READ_TOOLS,
  WRITE_TOOLS as QUERY_WRITE_TOOLS,
} from '../../src/query/tool-constants';
// 2026-09-30（防漂移复发）：以下四处"按工具名登记的清单"经台账 D-39/D-44 清理/订正过，
// 同样纳入守卫 —— 它们此前**不在受检名单**内 ⇒ 再次漂移不会被发现。
import { EXTERNAL_FETCH_TOOLS } from '../../src/query/ReActLoop';
import { MEMORABLE_TOOLS } from '../../src/hooks/postSampling/MemoryExtractionHook';
import {
  COMPLEXITY_READ_TOOLS,
  COMPLEXITY_WRITE_TOOLS,
} from '../../src/ai/router/TaskComplexityClassifier';
import { buildEnvironmentHints } from '../../src/ai/prompts/PlatformHints';
import { TOOL_NAMES } from '../../src/constants/toolNames.generated';
// D11-B（2026-10-11）：工具名单一来源 —— 声明面 = 常量表（工具类/loader/门禁共用）
import { TOOL_NAME_CONSTANTS } from '../../src/tools/toolNameConstants';
import {
  FILE_EDIT_TOOL_NAME,
  FILE_READ_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
} from '../../src/constants/tools';
// `tools/index.ts` 对外再导出的三个名字，**实际来源**是各工具的 prompt.ts
// （直连源模块而非桶：桶会拉入 ToolFactory 等重图，本文件刻意保持轻量可单跑）
import { FILE_WRITE_TOOL_NAME as BARREL_FILE_WRITE_TOOL_NAME } from '../../src/tools/FileWriteTool/prompt';
import { FILE_EDIT_TOOL_NAME as BARREL_FILE_EDIT_TOOL_NAME } from '../../src/tools/FileEditTool/prompt';
import { GREP_TOOL_NAME as BARREL_GREP_TOOL_NAME } from '../../src/tools/GrepTool/prompt';
import {
  CODEX_GUIDANCE,
  GOOGLE_GUIDANCE,
  OLLAMA_GUIDANCE,
} from '../../src/ai/prompts/ModelGuidance';
// 2026-10-08（LRTO 步骤"执行不了"事故）：角色/步骤工具名必须由任务类型经 TOOL_CATEGORIES 派生。
import {
  ARCHIVED_MISC_TOOLS,
  TOOL_CATEGORIES,
  getRealToolNamesForTask,
  getToolCategory,
} from '../../src/tools/toolCategories';
import { EXECUTOR_ROLE, PLANNER_ROLE } from '../../src/tasks/lro/contracts';
// D7 ④（2026-10-11）：双轨制排他性断言需按**默认装配**取运行期生效工具面
import { ToolFactory } from '../../src/tools/ToolFactory';
import {
  getBuiltinToolLoaders,
  loadTools,
} from '../../src/tools/utils/ToolManagerUtils';

/**
 * "真实注册名（声明口径）" —— **D11-B（2026-10-11，用户裁定 B）后的单一来源**：
 * 直接读 `tools/toolNameConstants.ts` 的 `TOOL_NAME_CONSTANTS`（工具类与 loader 均已引用它）。
 *
 * 历史（为何不再扫字面量）：原实现扫 `src/tools/**` 的 `name = '...' / name: '...'` 字面量，
 * 故有**两类盲区** —— ① 行首锚定收进非工具对象的 `name` 字段（高估）；②「声明了却无 loader」的
 * 名字查不出（台账 N-27/D-41）。常量表落地后，"声明面"即表本身：**既精确又完备**
 * （表 ⊇ 生成物生效面，且含 flag-gated 条件工具名）。
 */
const REGISTERED: Set<string> = new Set(Object.values(TOOL_NAME_CONSTANTS));

/** 已实证的 CC 漂移名（本仓不存在；不得再出现在这些清单里） */
const DRIFTED_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'search_code',
  'search_files',
  'search_content',
  'replace_in_file',
  'create_file',
  'delete_file',
  'delete_files',
  'list_files',
  'get_file_info',
  'memory_search',
  'session_list',
  'task_status',
  'plan_list',
  'ToolSearch',
  'TaskGet',
  'TaskList',
  'Edit',
  'Write',
  'Read',
  'Glob',
  'Grep',
  'Bash',
];

describe('工具名清单守卫：判据来自真实注册名', () => {
  it('扫描到的真实工具名规模合理（防扫描失效导致守卫恒真）', () => {
    expect(REGISTERED.size).toBeGreaterThan(50);
    for (const must of [
      'file_read',
      'file_write',
      'file_edit',
      'bash',
      'grep',
      'glob',
    ]) {
      expect(REGISTERED.has(must)).toBe(true);
    }
  });

  it('各清单中的名字**全部**是本仓真实注册名', () => {
    const lists: Array<[string, Set<string>]> = [
      ['MicroCompactionEngine.COMPACTABLE_TOOL_NAMES', COMPACTABLE_TOOL_NAMES],
      ['DreamPhases.READ_ONLY_TOOLS', READ_ONLY_TOOLS],
      ['promptSuggestion.SPECULATION_WRITE_TOOLS', SPECULATION_WRITE_TOOLS],
      ['promptSuggestion.SAFE_READ_ONLY_TOOLS', SAFE_READ_ONLY_TOOLS],
      ['query.tool-constants.READ_TOOLS', QUERY_READ_TOOLS],
      ['query.tool-constants.WRITE_TOOLS', QUERY_WRITE_TOOLS],
    ];

    for (const [label, list] of lists) {
      const unknown = [...list].filter((n) => !REGISTERED.has(n));
      expect({ list: label, unknown }).toEqual({ list: label, unknown: [] });
    }
  });

  it('清单**确实覆盖**本仓关键文件工具（否则空集也能骗过 ⊆ 检查）', () => {
    expect(COMPACTABLE_TOOL_NAMES.has('file_read')).toBe(true);
    expect(COMPACTABLE_TOOL_NAMES.has('file_write')).toBe(true);
    expect(COMPACTABLE_TOOL_NAMES.has('file_edit')).toBe(true);
    expect(READ_ONLY_TOOLS.has('file_read')).toBe(true);
    expect(SAFE_READ_ONLY_TOOLS.has('file_read')).toBe(true);
    expect(SPECULATION_WRITE_TOOLS.has('file_write')).toBe(true);
    expect(SPECULATION_WRITE_TOOLS.has('file_edit')).toBe(true);
    // query/tool-constants：真实名必须真的进了清单（否则"改了名但漏项"发现不了）
    expect(QUERY_READ_TOOLS.has('file_read')).toBe(true);
    // ⚠️ 2026-09-29（P2-3/T2）：原断言 `file_search` **∈** 读清单 —— 该断言**建立在过期假设上**：
    // `file_search` **不在生效注册面**（仅存在于 `ToolFactory.getAllBaseTools()`，台账 N-27 已认定
    // 该函数从未被使用；真实类 `FileSearchTool` 亦无任何 loader 引用）⇒ 属"永不命中的假覆盖"，已移除。
    expect(QUERY_READ_TOOLS.has('glob')).toBe(true);
    expect(QUERY_READ_TOOLS.has('file_search')).toBe(false);
    expect(QUERY_WRITE_TOOLS.has('file_write')).toBe(true);
    expect(QUERY_WRITE_TOOLS.has('file_edit')).toBe(true);
  });

  /**
   * **T3-①（P2-3，2026-09-29）**：清单中的名字必须落在**生效注册面**内。
   *
   * 判据 = **生成物 `TOOL_NAMES`**（源自 `getAllBuiltinToolLoaders()`），**不是**上面的
   * "扫描 `name = '...'` 声明"口径 —— 后者会**高估**注册面：`file_search` 这类"**文件里有、但
   * 没有任何 loader 引用**"的名字会被误算作注册名（台账 **D-15 / N-27** 的盲区），
   * 于是"清单抄了一个永不命中的名字"**查不出来**（这正是本 spec 要消灭的漂移）。
   *
   * 例外白名单（曾用 `PENDING_REGISTRATION`）已于 **2026-09-29 台账 D-34** 删空并**移除该机制**：
   * 原 3 项（`sessions_history` / `view_tasks` / `view_plan`）的保留依据是"台账 D-15 将来会注册"，
   * 而 D-34 裁定这 3 项（连同 `abort_task`）**属被取代/重复而非漏注册**，对应类已删除 ⇒ 依据不成立。
   * 此后**不允许**再为"抄进清单但未注册"的名字开例外（那正是本 spec 要消灭的漂移）。
   */
  it('清单中的名字必须落在"生效注册面"内（新建清单抄错名 ⇒ 失败）', () => {
    const live = new Set<string>(TOOL_NAMES);
    const lists: Array<[string, Set<string>]> = [
      ['COMPACTABLE_TOOL_NAMES', COMPACTABLE_TOOL_NAMES],
      ['READ_ONLY_TOOLS', READ_ONLY_TOOLS],
      ['SPECULATION_WRITE_TOOLS', SPECULATION_WRITE_TOOLS],
      ['SAFE_READ_ONLY_TOOLS', SAFE_READ_ONLY_TOOLS],
      ['QUERY_READ_TOOLS', QUERY_READ_TOOLS],
      ['QUERY_WRITE_TOOLS', QUERY_WRITE_TOOLS],
      // 2026-09-30 补：D-39/D-44 清理过的另四处（判据口径同上，均为"生效注册面"）
      ['ReActLoop.EXTERNAL_FETCH_TOOLS', EXTERNAL_FETCH_TOOLS],
      ['MemoryExtractionHook.MEMORABLE_TOOLS', MEMORABLE_TOOLS],
      [
        'TaskComplexityClassifier.COMPLEXITY_WRITE_TOOLS',
        new Set(COMPLEXITY_WRITE_TOOLS),
      ],
      [
        'TaskComplexityClassifier.COMPLEXITY_READ_TOOLS',
        new Set(COMPLEXITY_READ_TOOLS),
      ],
    ];
    for (const [label, list] of lists) {
      const unknown = [...list].filter((n) => !live.has(n));
      expect({ list: label, unknown }).toEqual({ list: label, unknown: [] });
    }
  });

  /**
   * 成员口径（用户明确要求先确认的两条）：
   *  · `glob` **是**真实注册名且在读清单中（`tools/search/GlobTool.ts`）；
   *  · `bash` **不**在任一清单 —— 命令类工具（入参 `command` + `cwd`），无按文件读写语义，
   *    调用方 `TAORLoop.act()` 提取的是 `path`/`filePath`/`directory` ⇒ 纳入只会得到假覆盖。
   */
  it('成员口径：glob 在读清单；bash/powershell 不在任何清单', () => {
    expect(REGISTERED.has('glob')).toBe(true);
    expect(QUERY_READ_TOOLS.has('glob')).toBe(true);

    for (const cmd of ['bash', 'powershell', 'code_run']) {
      expect(QUERY_READ_TOOLS.has(cmd)).toBe(false);
      expect(QUERY_WRITE_TOOLS.has(cmd)).toBe(false);
    }
  });

  it('清单里不再残留任何 CC 漂移名', () => {
    const all = [
      ...COMPACTABLE_TOOL_NAMES,
      ...READ_ONLY_TOOLS,
      ...SPECULATION_WRITE_TOOLS,
      ...SAFE_READ_ONLY_TOOLS,
      ...QUERY_READ_TOOLS,
      ...QUERY_WRITE_TOOLS,
      // 同上四处（2026-09-30 补）⇒ 一并覆盖"不得残留 CC 漂移名"
      ...EXTERNAL_FETCH_TOOLS,
      ...MEMORABLE_TOOLS,
      ...COMPLEXITY_WRITE_TOOLS,
      ...COMPLEXITY_READ_TOOLS,
    ];
    const leftovers = all.filter((n) => DRIFTED_NAMES.includes(n));
    expect(leftovers).toEqual([]);
  });

  /**
   * 2026-09-26 补：`constants/tools.ts` 与 `tools/index.ts`（桶再导出 prompt.ts 副本）是**同一类漂移的
   * 两个来源** —— 前者原为 `Read`/`Write`/`Edit`（CC 名），后者 `FileWriteTool/prompt.ts` 原为 `'write'`。
   * 后果不是"没影响"：`ToolExecutionService` 用它们判定"是否文件写/改操作"以登记**回滚追踪**，
   * 比较恒不成立 ⇒ 回滚的文件操作前追踪**从未触发**（静默失效）。
   */
  it('工具名常量必须等于真实注册名（constants 与 tools 桶**两个来源**都不得留漂移名）', () => {
    const pairs: Array<[string, string]> = [
      ['constants: FILE_READ_TOOL_NAME', FILE_READ_TOOL_NAME],
      ['constants: FILE_WRITE_TOOL_NAME', FILE_WRITE_TOOL_NAME],
      ['constants: FILE_EDIT_TOOL_NAME', FILE_EDIT_TOOL_NAME],
      ['tools桶: FILE_WRITE_TOOL_NAME', BARREL_FILE_WRITE_TOOL_NAME],
      ['tools桶: FILE_EDIT_TOOL_NAME', BARREL_FILE_EDIT_TOOL_NAME],
      ['tools桶: GREP_TOOL_NAME', BARREL_GREP_TOOL_NAME],
    ];
    for (const [label, value] of pairs) {
      expect({ label, value, registered: REGISTERED.has(value) }).toEqual({
        label,
        value,
        registered: true,
      });
      expect({ label, drifted: DRIFTED_NAMES.includes(value) }).toEqual({
        label,
        drifted: false,
      });
    }
  });

  it('同一工具名常量在不同模块里取值一致（防"同名不同值"再现）', () => {
    expect(BARREL_FILE_WRITE_TOOL_NAME).toBe(FILE_WRITE_TOOL_NAME);
    expect(BARREL_FILE_EDIT_TOOL_NAME).toBe(FILE_EDIT_TOOL_NAME);
    expect(BARREL_GREP_TOOL_NAME).toBe('grep');
  });
});

/**
 * 扫描目录下 `.ts` 文件中以**字符串字面量**出现的漂移工具名（判据=真实文件内容）。
 * 仅匹配引号形态 —— 注释里的反引号提及（如 `` `read_file` ``）不计入。
 */
function scanQuotedDriftedToolNames(dir: string): string[] {
  const drifted = new Set([
    'read_file',
    'write_file',
    'edit_file',
    'search_files',
    'search_code',
    'bash_exec',
    'bash_output',
    'execute_code',
    'web_extract',
    'browser_navigate',
    'browser_click',
    'browser_screenshot',
    'read_document',
    'lsp_diagnostics',
    'lsp_completion',
  ]);
  const hits: string[] = [];
  const walk = (d: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      // @ignore-catch 目录不存在 ⇒ 由下方"命中为空"断言暴露（不静默通过）
      return;
    }
    for (const entry of entries) {
      const abs = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(abs);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const source = readFileSync(abs, 'utf-8');
      for (const m of source.matchAll(/['"]([a-z_]+)['"]/g)) {
        if (drifted.has(m[1])) hits.push(`${entry.name}:${m[1]}`);
      }
    }
  };
  walk(dir);
  return hits;
}

/**
 * **2026-10-08（LRTO 步骤"执行不了"事故）**：`RoleConfig.toolsets` 抄的是 hermes 工具集名，
 * 展开后 23 个名字中 19 个在本仓不存在 ⇒ 步骤实际 0 个可用工具（实测 73 步 / 0 次工具调用）。
 * 现角色/步骤工具名一律由任务类型经 `TOOL_CATEGORIES` 派生 ⇒ 本守卫锁住"派生可用性"
 * 与"`src/tasks/**` 不得再手写清单"两条，防止再次抄错名。
 */
describe('角色/步骤工具清单守卫：必须派生自 TOOL_CATEGORIES', () => {
  it('getRealToolNamesForTask 含关键执行工具、无漂移名、规模合理', () => {
    const agentTools = new Set(getRealToolNamesForTask('agent'));
    for (const must of [
      'bash',
      'file_read',
      'file_write',
      'file_edit',
      'grep',
      'glob',
    ]) {
      expect({ tool: must, present: agentTools.has(must) }).toEqual({
        tool: must,
        present: true,
      });
    }
    expect([...agentTools].filter((n) => DRIFTED_NAMES.includes(n))).toEqual(
      []
    );
    // 规模合理性：agent 为全集，避免"派生为空集"也能骗过上面的包含断言
    expect(agentTools.size).toBeGreaterThan(30);
  });

  it('src/tasks/** 里不得再手写漂移工具名字面量（角色工具必须派生）', () => {
    const hits = scanQuotedDriftedToolNames(
      join(import.meta.dir, '../../src/tasks')
    );
    expect(hits).toEqual([]);
  });

  /**
   * 2026-10-08（真机复测暴露）：步骤因**安全策略拦截**不收敛 —— 实测只读命令本身在白名单
   * （`dir` 成功执行、PowerShell 白名单含 `get-`/`test-` 前缀），真正被拒的是**带 shell
   * 操作符**（`|` `>` `&&` `;`，`checkBashAllowlist` 一律 deny）与**非白名单构造**
   * （`[System.IO.File]::WriteAllText`⇒`COMMAND_NOT_ALLOWED`）。用户裁定「引导用专用工具」
   * （不改安全姿态）⇒ 角色提示词必须把该约束写死，否则模型会持续用管道读回证据。
   */
  it('角色提示词须引导专用工具、禁用 shell 操作符、并要求写后读回', () => {
    const executorPrompt = EXECUTOR_ROLE.systemPrompt;
    for (const tool of [
      'file_read',
      'file_write',
      'file_edit',
      'glob',
      'grep',
    ]) {
      expect(executorPrompt).toContain(tool);
    }
    expect(executorPrompt).toContain('管道');
    expect(executorPrompt).toContain('重定向');
    expect(executorPrompt).toContain('读回');
    // 规划约束：验收标准也必须可由专用工具核验（否则计划本身诱导 shell 取证据）
    expect(PLANNER_ROLE.systemPrompt).toContain('file_read');
  });
});

/**
 * **2026-10-08（用户要求"工具层面全面排查、确保 LLM 能随时按需调用"）**：
 * 工具"注册了却看不到"的**唯一机制**是**漏登记类别** —— `getToolCategory` 未命中 ⇒ `'misc'`
 * ⇒ `'misc'` 不在任何任务白名单 ⇒ 被 `filterToolsByTask` **静默裁剪** ⇒ 模型函数清单里没有它，
 * 而 `tool_search` 只服务"延迟工具（MCP）"，**对被裁剪的内置工具无恢复作用** ⇒ 永久不可见。
 *
 * 历史三次现场：`sessions_yield`（N-44）、`office:doc-pipeline`（N-45）、`workflow:run-template`（P0-2）。
 * 本守卫把"新增工具必须显式登记类别"变成**编译/CI 可失败**（此前全靠人工记得）。
 */
describe('工具可见性守卫：登记面全覆盖（N-44/N-45 防复发）', () => {
  it('生效注册面（TOOL_NAMES）每个工具都必须有**显式**类别，归档项除外', () => {
    const unregistered = TOOL_NAMES.filter(
      (n) => getToolCategory(n) === 'misc' && !ARCHIVED_MISC_TOOLS.has(n)
    );
    expect(unregistered).toEqual([]);
  });

  it('落 misc 的**恰好**是显式归档集合（防止新工具被顺手扔进 misc 而静默消失）', () => {
    const miscNow = TOOL_NAMES.filter((n) => getToolCategory(n) === 'misc');
    expect([...miscNow].sort()).toEqual([...ARCHIVED_MISC_TOOLS].sort());
  });

  /**
   * 运行期（模块/域）注册的工具**不在内置面内** ⇒ 上面的 TOOL_NAMES 遍历覆盖不到
   * （这正是 N-45 漏检的结构性原因）。故对已知族**显式锁住**；未知族由
   * `filterToolsByTask` 的"首次即 WARN"兜底（测试无法枚举运行期注册面）。
   */
  it('已知的"运行期注册"工具族必须保持显式登记（历史漏登记现场）', () => {
    const mustBeRegistered = [
      'office:workflow',
      'office:doc-pipeline',
      'workflow:run-template',
      'calendar:add',
      'calendar:list',
      'calendar:update',
      'calendar:delete',
      'mail:send',
      'knowledge_search',
      'knowledge_write',
      'knowledge_delete',
    ];
    for (const name of mustBeRegistered) {
      expect({ name, category: getToolCategory(name) }).not.toEqual({
        name,
        category: 'misc',
      });
    }
  });

  it('冒号命名空间工具按 **wire 形态**同样可解析类别（N-45：裁剪读的是 wire 名）', () => {
    for (const name of [
      'office:workflow',
      'office:doc-pipeline',
      'workflow:run-template',
      'calendar:add',
      'mail:send',
    ]) {
      const wire = name.replace(/:/g, '_');
      expect({ wire, category: getToolCategory(wire) }).toEqual({
        wire,
        category: getToolCategory(name),
      });
    }
  });
});

describe('工具名清单守卫：注入模型的提示词', () => {
  const hints = buildEnvironmentHints();

  it('不再提到本仓不存在的工具名', () => {
    for (const drifted of [
      'read_file',
      'write_file',
      'list_directory',
      'search_codebase',
      'Read/Write/Glob/Edit',
    ]) {
      expect(hints).not.toContain(drifted);
    }
  });

  it('明确给出真实工具名（file_read / file_write / glob / grep）', () => {
    expect(hints).toContain('file_read');
    expect(hints).toContain('file_write');
    // ⚠️ 2026-09-29（P2-3）：原断言要求提示词含 `file_search` —— **该断言本身把缺陷锁住了**：
    // 它要求注入模型的提示词给出一个**非注册名**（仅存在于 `ToolFactory.getAllBaseTools()` 死路径，
    // 台账 N-27；真实类 `FileSearchTool` 无 loader 引用）⇒ "教模型去调不存在的工具" 反被守卫**保护**。
    // 现改为真实搜索工具，并**反向断言**其不得出现（防回退）。
    expect(hints).toContain('glob');
    expect(hints).toContain('grep');
    expect(hints).not.toContain('file_search');
  });

  it('模型特定指引里同样不得出现漂移名（GOOGLE / OLLAMA / CODEX）', () => {
    const guidance = [GOOGLE_GUIDANCE, OLLAMA_GUIDANCE, CODEX_GUIDANCE];
    for (const text of guidance) {
      for (const drifted of [
        'read_file',
        'write_file',
        'edit_file',
        'search_files',
        'replace_in_file',
      ]) {
        expect(text).not.toContain(drifted);
      }
    }
    expect(CODEX_GUIDANCE).toContain('file_write');
    expect(CODEX_GUIDANCE).toContain('file_edit');
    expect(GOOGLE_GUIDANCE).toContain('file_read');
  });
});

/**
 * S2-3（2026-10-11）新增门禁：G6「运行期注册族快照」。
 *
 * ⚠️ G5「声明名 ⊆ 生效面」**本轮未落地**（如实）：可落地的方向有两面 ——
 * ① 清单 ⊆ 生效面 已在既有用例覆盖；② **声明面 ⊆ 生效面**（查出"声明了但无 loader 注册"的
 * N-27 家族）需要"仅识别真实工具类"的扫描口径 —— 现有 `scanRegisteredToolNames()` 为
 * **行首锚定**且会收进非工具类的 `name` 字段：实测 `TOOL_NAMES ⊄ REGISTERED`（13 个名字以
 * 内联对象字面量 / 常量赋值形式声明，行首锚定匹配不到），故两个方向都会产生**假阳性**
 * ⇒ 需独立设计（见方案 §4 阶段 2 备注），不在本轮硬上。
 */
/** G6 判据（纯函数，供真实快照与**负向自证**共用）：从登记表键名派生"运行期命名空间族"前缀 */
function deriveNamespaceFamilies(keys: string[]): string[] {
  const families = new Set<string>();
  for (const key of keys) {
    const colon = key.indexOf(':');
    if (colon > 0) {
      families.add(key.slice(0, colon));
    } else if (key.startsWith('knowledge_')) {
      families.add('knowledge');
    }
  }
  return [...families].sort();
}

describe('S2-3 契约与清单门禁（G5 / G6）', () => {
  /**
   * **G5（D11-B 后落地，2026-10-11）**：常量表 = 声明的**单一来源**；它与生成物"生效面"的**差额**
   * 只允许是**已知的不可见工具**。新增未知差额 ⇒ CI 失败，强制"显式登记或修正注册"。
   *
   * ⚠️ **口径订正（2026-10-16，P4a 评估实证）**：本集合原注释称"flag-gated 且默认关"，实测
   * 它**混装两类**（见 `dev_docs/20261016/工具可见性治理-P4a-影子工具评估.md` §0.1）：
   * - **E 类（未接线）**：在 `buildBuiltinToolLoaders()` 与 `BUILTIN_TOOL_FACTORIES` 里**零命中**
   *   —— 连"与 flag 无关的全量视图"都不在；
   * - **D 类（flag 门控）**：有 loader、仅因默认关而不实例化。
   *
   * ✅ 2026-10-20（U-03 收口，用户裁定「开 flag 接线」）：原 D 类唯一成员 `send_message` 已把
   * `SEND_MESSAGE` 默认值改为 `true` 并补 `TOOL_EFFECTS` 声明 ⇒ **移出本集合**（77 → 78）；
   * 现集合内 **11 个全部为 E 类**（未接线），无 D 类。
   *
   * ⚠️ 移出本集合的**唯一正规途径**是"真接线"（登记类别 + loader + 重算生成物 + 声明 effects），
   * 见 P4b；`task_output` 即首个（2026-10-16 接线，75 → 76）。
   */
  const KNOWN_CONDITIONAL_TOOL_NAMES = [
    'agents_list',
    'kanban',
    'mcp_auth',
    'music_generate',
    'tts',
  ];
  // D1 接线（2026-10-11）：`TEAM_CREATE`/`TEAM_DELETE` 成为**变体默认生效**（coding）
  // ⇒ `team_create`/`team_delete` 移出本差额集（进入生成物 `TOOL_NAMES`，75 名）。

  it('G5：生效面 ⊆ 声明面（每个生效工具名都必须在常量表内）', () => {
    const declared = new Set(Object.values(TOOL_NAME_CONSTANTS));
    expect(TOOL_NAMES.filter((n) => !declared.has(n))).toEqual([]);
  });

  it('G5：声明面 − 生效面 = 已知条件工具集（新增未知差额 ⇒ 失败，需显式登记）', () => {
    const effective = new Set<string>(TOOL_NAMES);
    const notEffective = Object.values(TOOL_NAME_CONSTANTS)
      .filter((n) => !effective.has(n))
      .sort();
    expect(notEffective).toEqual([...KNOWN_CONDITIONAL_TOOL_NAMES].sort());
  });

  /**
   * **P4b 接线回归锁（2026-10-16）**：影子工具"接线"的**可证伪判据** = 它同时满足
   * ① 进生成物（⇒ 会被真实实例化）② 不在差额集（⇒ 不再是 conditional 影子工具）。
   * 若日后有人把已接线工具的 loader/登记回退，本用例即红。
   *
   * `send_message`（2026-10-20）：原属 **D 类**（loader / 类别 / 真实现齐备，仅 flag 默认关）⇒
   * 用户裁定「开 flag 接线」后 `SEND_MESSAGE` 默认 `true` 并补 `TOOL_EFFECTS` ⇒ 同属已接线。
   */
  const P4B_WIRED_TOOL_NAMES = ['task_output', 'pdf', 'send_message'];

  /**
   * **P4b 期"下线"（非接线）的工具**：`propose_plan` —— 2026-10-16 用户裁定「审批入口合并到
   * `ask_user_question`」⇒ 它从**声明面与生效面同时移除**（既不在常量表、也不在生成物），
   * 故**不属**差额集（差额集只统计"声明了但没生效"），也**不属**上面的接线锁。
   * 本锁防的是"半下线"：只摘 loader 却留着常量（会被 G5 判为 conditional）或只删常量却留着实现。
   *
   * 2026-10-23（Q-18，用户拍板）：6 个"下线类"影子工具同步从声明面移除
   * （`nodes` / `session_status` / `sessions_send` / `sessions_spawn` / `update_plan` / `thinking`），
   * 实现文件按 CD05 保留一版观察（第 2 步再删）—— 故它们同属本集合。
   */
  const P4B_RETIRED_TOOL_NAMES = [
    'propose_plan',
    'nodes',
    'session_status',
    'sessions_send',
    'sessions_spawn',
    'update_plan',
    'thinking',
  ];

  it('P4b 接线回归锁：已接线工具进生效面且已移出 conditional 差额集', () => {
    for (const name of P4B_WIRED_TOOL_NAMES) {
      expect(TOOL_NAMES).toContain(name);
      expect(KNOWN_CONDITIONAL_TOOL_NAMES).not.toContain(name);
    }
    // 反向自证：差额集随接线**净收缩**（15 − 已接线数 − 已下线数），而不是"新增登记"
    expect(KNOWN_CONDITIONAL_TOOL_NAMES.length).toBe(
      15 - P4B_WIRED_TOOL_NAMES.length - P4B_RETIRED_TOOL_NAMES.length
    );
  });

  it('P4b 下线锁：已下线工具在声明面与生效面**同时**不存在（防"半下线"）', () => {
    const declared = new Set<string>(Object.values(TOOL_NAME_CONSTANTS));
    for (const name of P4B_RETIRED_TOOL_NAMES) {
      expect(declared.has(name)).toBe(false);
      expect(TOOL_NAMES).not.toContain(name);
      expect(KNOWN_CONDITIONAL_TOOL_NAMES).not.toContain(name);
    }
  });

  it('门禁自证（负向夹具）：新增命名空间族会被判违规 ⇒ 快照非恒真', () => {
    const fixture = [
      'file_read',
      'calendar:add',
      'billing:pay', // 虚构的新族
      'knowledge_search',
    ];
    expect(deriveNamespaceFamilies(fixture)).toContain('billing');
  });

  it('G6：运行期注册族快照 —— 命名空间族前缀集合恒定（新增族 ⇒ 失败并需显式确认）', () => {
    expect(deriveNamespaceFamilies(Object.keys(TOOL_CATEGORIES))).toEqual([
      'calendar',
      'knowledge',
      'mail',
      'office',
      'workflow',
    ]);
  });
});

/**
 * **S2-4 双轨制排他性断言**（D7 ④，2026-10-11 用户裁定「①+④ 组合」）。
 *
 * 静态登记"**100% 重叠**的事实源双轨对"（同一读取/写入语义由两套工具提供 ⇒ 模型可能二选一、
 * 结果不一致）。以**默认装配**（`getBuiltinToolLoaders()` = 生效视图）为判据断言"不得同时激活"，
 * 防止 D7 ① 的回退性复发（如有人把 VFS 文件类工具改回无条件注册）。
 */
describe('S2-4 双轨制排他性断言（D7 ④）', () => {
  /** 100% 重叠的"事实源双轨"静态登记表（新增重叠对 ⇒ 在此登记） */
  const OVERLAP_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['read_vfs', 'file_read'],
    ['write_vfs', 'file_write'],
  ];

  /** 判据（纯函数，供门禁自证/负向夹具共用）：返回**同时激活**的重叠对 */
  function findActiveOverlapViolations(
    active: ReadonlySet<string>,
    pairs: ReadonlyArray<readonly [string, string]>
  ): string[] {
    return pairs
      .filter(([a, b]) => active.has(a) && active.has(b))
      .map(([a, b]) => `${a}↔${b}`)
      .sort();
  }

  it('默认装配下，100% 重叠工具对不得同时激活', () => {
    const active = new Set(
      loadTools(new ToolFactory(), getBuiltinToolLoaders()).map((t) => t.name)
    );
    // 防空转（恒真守卫）：默认面确实含 file_read/file_write ⇒ 断言才有意义
    expect(active.has('file_read')).toBe(true);
    expect(active.has('file_write')).toBe(true);
    expect(findActiveOverlapViolations(active, OVERLAP_PAIRS)).toEqual([]);
  });

  it('门禁自证（负向夹具）：同时激活 ⇒ 判违规 ⇒ 非恒真', () => {
    const fixture = new Set(['file_read', 'read_vfs', 'file_write']);
    expect(findActiveOverlapViolations(fixture, OVERLAP_PAIRS)).toEqual([
      'read_vfs↔file_read',
    ]);
  });
});
