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
import { READ_ONLY_TOOLS } from '../../src/tasks/dream/DreamPhases';
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
import { TOOL_NAMES } from '../../src/tools/toolNames.generated';
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

/** 扫描 `src/tools/**` 里工具类的 `name = '...'` 声明（判据=真实代码） */
function scanRegisteredToolNames(): Set<string> {
  const toolsDir = join(import.meta.dir, '../../src/tools');
  const names = new Set<string>();
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // @ignore-catch 目录不存在 ⇒ 交由下面的规模断言暴露（不静默通过）
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(abs);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const source = readFileSync(abs, 'utf-8');
      for (const m of source.matchAll(
        /^\s*(?:override\s+)?name\s*=\s*'([a-z_]+)'/gm
      )) {
        names.add(m[1]);
      }
    }
  };
  walk(toolsDir);
  return names;
}

const REGISTERED = scanRegisteredToolNames();

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
