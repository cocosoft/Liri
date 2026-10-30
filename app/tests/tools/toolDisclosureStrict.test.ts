/**
 * P0-1（2026-10-30）：严格披露预算 —— `FEATURE_TOOL_DISCLOSURE_STRICT`
 *
 * 契约：
 * - 开关**默认关** ⇒ `resolveDisclosureBudget()` 返回 `undefined`，裁剪面逐字不变；
 * - 开关开 ⇒ `coding` / `agent` 面按 `STRICT_DISCLOSURE_BUDGETS`（25）截断，
 *   恒集（`todo_write` / `agent`）永远保留，其余按 `STRICT_DISCLOSURE_PRIORITY` 顺序取；
 * - 被截断的工具**仍注册可调用**（本函数只筛"下发面"，不碰注册表）—— 与 AC-16 同口径；
 * - `getRealToolNamesForTask` 与 `filterToolsByTask` **同判据**（不得形成第二套口径）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import {
  STRICT_DISCLOSURE_BUDGETS,
  STRICT_DISCLOSURE_PRIORITY,
  filterToolsByTask,
  getRealToolNamesForTask,
  resolveDisclosureBudget,
  trimNamesToDisclosureBudget,
} from '../../src/tools/toolCategories';

const ENV_KEY = 'FEATURE_TOOL_DISCLOSURE_STRICT';
const prevEnv = process.env[ENV_KEY];

afterEach(() => {
  if (prevEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = prevEnv;
});

describe('trimNamesToDisclosureBudget（纯函数）', () => {
  it('数量未超预算 ⇒ 原样返回，不丢弃', () => {
    const r = trimNamesToDisclosureBudget(['a', 'b'], 5);
    expect(r.kept).toEqual(['a', 'b']);
    expect(r.dropped).toEqual([]);
  });

  it('超预算 ⇒ 按优先级保留、未登记名先被丢弃（返回值保持原顺序）', () => {
    const names = ['zzz_unknown', 'todo_write', 'fast_tool', 'agent', 'medium'];
    const r = trimNamesToDisclosureBudget(names, 3, {
      mandatory: new Set(['todo_write', 'agent']),
      priority: ['fast_tool', 'medium'],
    });
    expect(r.kept).toEqual(['todo_write', 'fast_tool', 'agent']); // 原顺序
    expect(r.dropped).toEqual(['medium', 'zzz_unknown']); // 丢弃清单升序
  });

  it('恒集数量本身超预算 ⇒ 恒集全留（预算是软上限）', () => {
    const mandatory = new Set(['m1', 'm2', 'm3']);
    const r = trimNamesToDisclosureBudget(['m1', 'm2', 'm3', 'x', 'y'], 2, {
      mandatory,
      priority: ['x', 'y'],
    });
    expect(r.kept).toEqual(['m1', 'm2', 'm3']);
    expect(r.dropped).toEqual(['x', 'y']);
  });

  it('输入去重（同名重复不占两个预算）', () => {
    const r = trimNamesToDisclosureBudget(['a', 'a', 'b'], 2, {
      mandatory: new Set<string>(),
      priority: ['a', 'b'],
    });
    expect(r.kept).toEqual(['a', 'b']);
    expect(r.dropped).toEqual([]);
  });
});

describe('resolveDisclosureBudget（开关语义）', () => {
  it('默认关 ⇒ undefined（零行为变更）', () => {
    delete process.env[ENV_KEY];
    expect(resolveDisclosureBudget('coding')).toBeUndefined();
    expect(resolveDisclosureBudget('agent')).toBeUndefined();
    expect(resolveDisclosureBudget('default')).toBeUndefined();
  });

  it('开关开 ⇒ 仅 coding / agent 有预算，其它任务面不受影响', () => {
    process.env[ENV_KEY] = 'true';
    expect(resolveDisclosureBudget('coding')).toBe(
      STRICT_DISCLOSURE_BUDGETS.coding
    );
    expect(resolveDisclosureBudget('agent')).toBe(
      STRICT_DISCLOSURE_BUDGETS.agent
    );
    expect(resolveDisclosureBudget(undefined)).toBeUndefined();
    expect(resolveDisclosureBudget('quick')).toBeUndefined();
  });
});

/** 造一批"coding 面"的定义（用真实工具名，类别判据才走得通） */
const CODING_DEFINITIONS = [
  'file_read',
  'file_write',
  'file_edit',
  'bash',
  'powershell',
  'grep',
  'glob',
  'read_project_file',
  'write_project_file',
  'file_convert',
  'code_run',
  'lsp',
  'notebook',
  'create_project',
  'todo_write',
  'agent',
  'tool_search',
  'web_fetch',
  'web_search',
  'ask_user_question',
  'mcp_tool',
  'sessions',
  'sessions_yield',
  // P1（2026-10-30）：族合并后的真名（旧名不再是注册名，夹具改用合并名）
  'vfs',
  'skill',
  'plan',
  'clipboard',
  'config',
  'monitor',
  'trace_recording',
  'kanban',
  'knowledge_save',
  'task_list',
  'task_output',
  'task_stop',
  'cron',
  // P1 合并后新增的 coding 白名单内条目（保证夹具数量高于 strict 预算，截断路径仍被覆盖）
  'knowledge_search',
  'knowledge_write',
  'knowledge_import',
  'knowledge_export',
  'knowledge_delete',
  'repl',
  'tungsten',
  'time',
].map((name) => ({ name }));

describe('filterToolsByTask：严格披露截断（coding 面）', () => {
  it('开关关 ⇒ 不截断（类别白名单内全部保留，数量高于 strict 预算）', () => {
    delete process.env[ENV_KEY];
    // 注：入参里少数名字类别未登记（如 trace_recording ⇒ misc），会被类别白名单先筛掉；
    // 故这里断言"高于预算"而非"等于入参长度"。
    const kept = filterToolsByTask(CODING_DEFINITIONS, 'coding');
    expect(kept.length).toBeGreaterThan(STRICT_DISCLOSURE_BUDGETS.coding);
    expect(kept.map((t) => t.name)).toContain('trace_recording');
  });

  it('开关开 ⇒ 截到预算内，核心工具与恒集保留', () => {
    process.env[ENV_KEY] = 'true';
    const kept = filterToolsByTask(CODING_DEFINITIONS, 'coding');
    const names = kept.map((t) => t.name);

    expect(kept.length).toBe(STRICT_DISCLOSURE_BUDGETS.coding);
    for (const core of [
      'file_read',
      'file_write',
      'file_edit',
      'bash',
      'grep',
      'glob',
    ]) {
      expect(names).toContain(core);
    }
    // 恒集不可裁
    expect(names).toContain('todo_write');
    expect(names).toContain('agent');
    // 优先级末尾 / 未登记名的工具被截断
    // P1（2026-10-30）：`trace_recording` 已在优先级名单内（落在 25 名之内）⇒ 断言改用
    // 明确不在优先级名单里的 `knowledge_search`（真实存在但排在最后、必被截断）。
    expect(names).not.toContain('knowledge_search');
    // 保持原顺序（下发面稳定）
    const originalOrder = CODING_DEFINITIONS.map((t) => t.name).filter((n) =>
      names.includes(n)
    );
    expect(names).toEqual(originalOrder);
  });

  it('优先级名单前 12 个与默认披露集同源（顺序即保留顺序）', () => {
    // 只断言"默认披露集成员都在优先级前列"这一结构性约束，避免抄第二份名单
    for (const name of [
      'file_read',
      'file_write',
      'file_edit',
      'bash',
      'grep',
    ]) {
      expect(STRICT_DISCLOSURE_PRIORITY.indexOf(name)).toBeGreaterThanOrEqual(
        0
      );
      expect(STRICT_DISCLOSURE_PRIORITY.indexOf(name)).toBeLessThan(12);
    }
  });
});

describe('getRealToolNamesForTask：与 filterToolsByTask 同判据', () => {
  it('开关开 ⇒ 名字清单同样不超过预算，且含恒集', () => {
    process.env[ENV_KEY] = 'true';
    const names = getRealToolNamesForTask('coding');
    expect(names.length).toBeLessThanOrEqual(STRICT_DISCLOSURE_BUDGETS.coding);
    expect(names).toContain('todo_write');
  });

  it('开关关 ⇒ 不截断（默认面仍由 AC-16 白名单约束）', () => {
    delete process.env[ENV_KEY];
    const names = getRealToolNamesForTask('coding');
    expect(names.length).toBeGreaterThan(STRICT_DISCLOSURE_BUDGETS.coding);
  });
});
