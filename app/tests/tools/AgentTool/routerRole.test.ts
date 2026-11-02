/**
 * P36 · router 角色（只做分诊，不亲自动手）
 *
 * 覆盖方案 §5 P36 的验收口径：
 * ① 白名单**恰 4 个**，且四个名字都真实存在于工具生成清单（编译期 + 运行时双保险）；
 * ② 工具池按角色声明取子集：`router` 上下文只剩 4 个，`bash` / `file_edit` 不可达；
 * ③ 负向自证：一旦把 `bash` 塞进白名单，本文件的断言即变红；
 * ④ 模型显式请求越出白名单 ⇒ `findToolsOutsideRole` 给出越界项（调用方 fail-closed）；
 * ⑤ 角色声明可从 DB 往返（`allowed_tools` / `disallowed_tools`）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TOOL_NAMES } from '@openliri/infra/constants/toolNames.generated';
import type { Tool } from '../../../src/tools/types/Tool';
import { AgentToolPool } from '../../../src/tools/AgentTool/agentToolPool';
import { AgentRoleStore } from '../../../src/workspace/AgentRoleStore';
import { resolveAgentDescriptor } from '../../../src/tools/AgentTool/AgentDescriptorResolver';
import {
  ROUTER_ROLE_ID,
  ROUTER_ROLE_TOOL_NAMES,
  ROUTER_AGENT_DEFINITION,
  findToolsOutsideRole,
  isToolAllowedByRole,
} from '../../../src/tools/AgentTool/routerRole';

/** 参考实现 → Liri 的四个动作（与 `routerRole.ts` 的映射注释同源） */
const EXPECTED_ROUTER_TOOLS = [
  'agent',
  'ask_user_question',
  'task_list',
  'task_output',
];

function fakeTool(name: string): Tool {
  return { name } as Tool;
}

function makePool(toolNames: string[]): AgentToolPool {
  const tools = toolNames.map(fakeTool);
  return new AgentToolPool({
    getAllTools: () => tools,
    getMaxSubagentDepth: () => 3,
    // 本用例只验证「可继承池」的收窄，过滤函数不参与
    filterToolPool: (_allowed, _denied, pool) => pool,
  });
}

describe('router 白名单（恰 4 个）', () => {
  it('白名单恰好是 4 个，且四个名字都在工具生成清单中', () => {
    expect([...ROUTER_ROLE_TOOL_NAMES]).toEqual(EXPECTED_ROUTER_TOOLS);
    for (const name of ROUTER_ROLE_TOOL_NAMES) {
      expect(TOOL_NAMES as readonly string[]).toContain(name);
    }
  });

  it('负向自证：白名单不含写盘 / 执行类工具', () => {
    expect(ROUTER_ROLE_TOOL_NAMES as readonly string[]).not.toContain('bash');
    expect(ROUTER_ROLE_TOOL_NAMES as readonly string[]).not.toContain(
      'file_edit'
    );
    expect(ROUTER_ROLE_TOOL_NAMES as readonly string[]).not.toContain(
      'file_write'
    );
  });

  it('内置定义把白名单挂在 tools 上（不是 disallowedTools）', () => {
    expect(ROUTER_AGENT_DEFINITION.agentType).toBe(ROUTER_ROLE_ID);
    expect(ROUTER_AGENT_DEFINITION.tools).toEqual(EXPECTED_ROUTER_TOOLS);
    expect(ROUTER_AGENT_DEFINITION.disallowedTools).toBeUndefined();
  });

  it('数量守卫：白名单必须是 4（新增/删除都得改测试与文档）', () => {
    expect(ROUTER_ROLE_TOOL_NAMES.length).toBe(4);
  });
});

describe('isToolAllowedByRole / findToolsOutsideRole', () => {
  it('大小写不敏感；未声明 / 空数组 ⇒ 不限制', () => {
    expect(isToolAllowedByRole(ROUTER_ROLE_TOOL_NAMES, 'Task_Output')).toBe(
      true
    );
    expect(isToolAllowedByRole(undefined, 'bash')).toBe(true);
    expect(isToolAllowedByRole([], 'bash')).toBe(true);
    expect(isToolAllowedByRole(ROUTER_ROLE_TOOL_NAMES, 'bash')).toBe(false);
  });

  it('越界项如实列出（fail-closed 的输入）', () => {
    expect(
      findToolsOutsideRole(ROUTER_ROLE_TOOL_NAMES, ['agent', 'task_output'])
    ).toEqual([]);
    expect(
      findToolsOutsideRole(ROUTER_ROLE_TOOL_NAMES, [
        'agent',
        'bash',
        'file_edit',
      ])
    ).toEqual(['bash', 'file_edit']);
    // 未声明白名单 ⇒ 没有越界概念
    expect(findToolsOutsideRole(undefined, ['bash'])).toEqual([]);
  });
});

describe('AgentToolPool 按角色声明取子集', () => {
  const ALL = [
    'agent',
    'ask_user_question',
    'task_list',
    'task_output',
    'bash',
    'file_edit',
    'sessions_yield',
  ];

  it('router：上下文工具表恰为 4 个（bash / file_edit 不在其中）', () => {
    const pool = makePool(ALL);
    const names = pool
      .getInheritableToolPool({ allowedTools: ROUTER_ROLE_TOOL_NAMES })
      .map((t) => t.name);
    expect(names.sort()).toEqual([...EXPECTED_ROUTER_TOOLS].sort());
  });

  it('无声明 ⇒ 回退现状（全量 − 恒阻断；委派入口仍按 allowDelegation 处理）', () => {
    const pool = makePool(ALL);
    const names = pool.getInheritableToolPool().map((t) => t.name);
    // sessions_yield 恒阻断；agent 默认阻断（allowDelegation=false）
    expect(names).toContain('bash');
    expect(names).toContain('file_edit');
    expect(names).not.toContain('sessions_yield');
    expect(names).not.toContain('agent');
  });

  it('授权委派后 agent 回到池中（与白名单正交）', () => {
    const pool = makePool(ALL);
    const names = pool
      .getInheritableToolPool({
        allowDelegation: true,
        allowedTools: ROUTER_ROLE_TOOL_NAMES,
      })
      .map((t) => t.name);
    expect(names).toContain('agent');
  });
});

describe('描述符解析链透出 allowedTools', () => {
  it('DB 角色命中 ⇒ allowedTools 随描述符下发', async () => {
    const result = await resolveAgentDescriptor({
      subagentType: 'router',
      baseSystemPrompt: 'base',
      deps: {
        getRole: async () => ({
          state: 'ok',
          role: {
            agentId: 'router',
            systemPrompt: 'router prompt',
            allowedTools: [...ROUTER_ROLE_TOOL_NAMES],
          },
        }),
        getRegistered: () => null,
        builtinTypeNames: ['router'],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('role-store');
      expect(result.allowedTools).toEqual([...ROUTER_ROLE_TOOL_NAMES]);
    }
  });

  it('内置 router ⇒ 白名单来自 getBuiltinAllowedTools', async () => {
    const result = await resolveAgentDescriptor({
      subagentType: 'router',
      baseSystemPrompt: 'base',
      deps: {
        getRole: async () => ({ state: 'missing' }),
        getRegistered: () => null,
        builtinTypeNames: ['router'],
        getBuiltinAllowedTools: (type) =>
          type === 'router' ? [...ROUTER_ROLE_TOOL_NAMES] : undefined,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('builtin');
      expect(result.allowedTools).toEqual([...ROUTER_ROLE_TOOL_NAMES]);
    }
  });

  it('未注入 getBuiltinAllowedTools ⇒ 不下发白名单（既有调用方行为不变）', async () => {
    const result = await resolveAgentDescriptor({
      subagentType: 'router',
      baseSystemPrompt: 'base',
      deps: {
        getRole: async () => ({ state: 'missing' }),
        getRegistered: () => null,
        builtinTypeNames: ['router'],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.allowedTools).toBeUndefined();
  });
});

describe('AgentRoleStore：allowed_tools / disallowed_tools 往返', () => {
  let dir: string;
  let store: AgentRoleStore | null = null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'p36-role-'));
  });

  afterEach(() => {
    store?.close();
    store = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('写入后可读回；更新为空数组 ⇒ 撤销声明（NULL）', async () => {
    store = new AgentRoleStore(join(dir, 'roles.db'));
    await store.init();
    const id = await store.insert({
      agentId: 'router-x',
      name: 'RouterX',
      expertise: [],
      weight: 1,
      systemPrompt: 'p',
      allowedTools: [...ROUTER_ROLE_TOOL_NAMES],
      disallowedTools: ['bash'],
      icon: '🧭',
      sortOrder: 99,
      enabled: true,
    });

    const created = await store.getByAgentId('router-x');
    expect(created?.allowedTools).toEqual([...ROUTER_ROLE_TOOL_NAMES]);
    expect(created?.disallowedTools).toEqual(['bash']);

    await store.update(id, { allowedTools: [], disallowedTools: [] });
    const updated = await store.getByAgentId('router-x');
    expect(updated?.allowedTools).toBeUndefined();
    expect(updated?.disallowedTools).toBeUndefined();
  });

  it('解析链三态入口同样携带工具声明', async () => {
    store = new AgentRoleStore(join(dir, 'roles2.db'));
    await store.init();
    await store.insert({
      agentId: 'triage',
      name: 'Triage',
      expertise: [],
      weight: 1,
      systemPrompt: 'p',
      allowedTools: ['agent'],
      icon: '🧭',
      sortOrder: 1,
      enabled: true,
    });
    const lookup = await store.resolveForDelegation('triage');
    expect(lookup.state).toBe('ok');
    if (lookup.state === 'ok') {
      expect(lookup.role.allowedTools).toEqual(['agent']);
    }
  });
});
