/**
 * P1（2026-10-30）：同资源族合并工具 + 旧名 alias 入参归一
 *
 * 契约（治理方案 §4.1）：
 * - 六族合并为 `vfs` / `sleep` / `skill` / `cron` / `worktree` / `task_list`，旧名保留为 **alias**；
 * - 旧名调用在**参数校验前**由 `applyAliasInputDefaults()` 补判别字段（显式入参优先）；
 * - 判别字段缺省时按形态推断 / 默认只读分支兜底；**不得**把写分支设为默认；
 * - 风险按 op 分档（只读 op ⇒ read，写 op ⇒ write；破坏性 op 单列）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { FamilyTool } from '../../src/tools/families/familyTool';
import { createVfsFamilyTool } from '../../src/tools/families/VfsFamilyTool';
import { createSleepFamilyTool } from '../../src/tools/families/SleepFamilyTool';
import { createSkillFamilyTool } from '../../src/tools/families/SkillFamilyTool';
import { createCronFamilyTool } from '../../src/tools/families/CronFamilyTool';
import { createWorktreeFamilyTool } from '../../src/tools/families/WorktreeFamilyTool';
import { createTaskListFamilyTool } from '../../src/tools/families/TaskListFamilyTool';
import { applyAliasInputDefaults } from '../../src/tools/utils/ToolUtils';
import {
  getBuiltinToolLoaders,
  loadTools,
} from '../../src/tools/utils/ToolManagerUtils';
import { ToolFactory } from '../../src/tools/ToolFactory';
import { LEGACY_ALIAS_TOOL_NAMES } from '../../src/constants/toolNameConstants';
import type { Tool } from '../../src/tools/types/Tool';

const ENV_KEYS = ['FEATURE_VFS_ENABLED'];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

/** 合成成员：只实现被 FamilyTool 用到的最小面（走 cast，避免为测试造完整 ToolInfo） */
function fakeMember(
  name: string,
  output: string,
  readOnly: boolean
): () => Tool {
  return () =>
    ({
      name,
      description: name,
      params: [],
      isEnabled: () => true,
      isReadOnly: () => readOnly,
      isDestructive: () => false,
      isConcurrencySafe: () => readOnly,
      execute: async () => ({ success: true, output }),
      getInfo: () => ({
        name,
        description: name,
        params: [],
        enabled: true,
        readOnly,
        destructive: false,
        concurrencySafe: readOnly,
      }),
    }) as unknown as Tool;
}

/** 合成一个最小族工具（只测分派语义，不依赖真实工具实现） */
function makeSyntheticFamily(): FamilyTool {
  return new FamilyTool({
    name: 'demo_family',
    description: 'demo',
    discriminator: 'op',
    discriminatorDescription: 'op',
    defaultKey: 'get',
    params: [
      { name: 'id', type: 'string', description: 'id', required: false },
    ],
    members: [
      {
        key: 'create',
        legacyName: 'demo_create',
        required: ['id'],
        readOnly: false,
        create: fakeMember('demo_create', 'created', false),
      },
      {
        key: 'get',
        legacyName: 'demo_get',
        readOnly: true,
        create: fakeMember('demo_get', 'got', true),
      },
    ],
  });
}

const CTX = {} as Parameters<FamilyTool['execute']>[1];

describe('FamilyTool：判别字段分派', () => {
  it('op 命中成员 ⇒ 委托给该成员实现', async () => {
    const tool = makeSyntheticFamily();
    expect((await tool.execute({ op: 'create', id: 'x' }, CTX)).output).toBe(
      'created'
    );
    expect((await tool.execute({ op: 'get' }, CTX)).output).toBe('got');
  });

  it('缺少 op ⇒ 走 defaultKey（只读兜底，不会误落写分支）', async () => {
    const tool = makeSyntheticFamily();
    expect((await tool.execute({}, CTX)).output).toBe('got');
  });

  it('op 非法 / 缺必填 ⇒ 明确失败（不静默执行别的分支）', async () => {
    const tool = makeSyntheticFamily();
    const bad = await tool.execute({ op: 'nope' }, CTX);
    expect(bad.success).toBe(false);
    expect(String(bad.error)).toContain('可选值');

    const missing = await tool.execute({ op: 'create' }, CTX);
    expect(missing.success).toBe(false);
    expect(String(missing.error)).toContain('id');
    expect(tool.validateInput({ op: 'create' }).result).toBe(false);
    expect(tool.validateInput({ op: 'create', id: 'x' }).result).toBe(true);
  });

  it('风险按 op 分档：只读成员 ⇒ read，写成员 ⇒ write', () => {
    const tool = makeSyntheticFamily();
    expect(tool.isReadOnly({ op: 'get' })).toBe(true);
    expect(tool.isReadOnly({ op: 'create' })).toBe(false);
    expect(tool.riskClassFor({ op: 'get' })).toBe('read');
    expect(tool.riskClassFor({ op: 'create' })).toBe('write');
  });
});

describe('旧名 alias 入参归一（applyAliasInputDefaults）', () => {
  it('旧名调用 ⇒ 补判别字段；显式入参优先', () => {
    const tool = createVfsFamilyTool();
    expect(tool.aliasInputDefaults?.['write_vfs']).toEqual({ op: 'write' });
    expect(
      applyAliasInputDefaults(tool, 'write_vfs', { path: 'a://b' })
    ).toEqual({ op: 'write', path: 'a://b' });
    expect(
      applyAliasInputDefaults(tool, 'write_vfs', { op: 'read', path: 'a://b' })
    ).toEqual({ op: 'read', path: 'a://b' });
  });

  it('真名调用 / 未登记别名 ⇒ 原样返回（同一引用，零拷贝）', () => {
    const tool = createVfsFamilyTool();
    const input = { op: 'read', path: 'a://b' };
    expect(applyAliasInputDefaults(tool, 'vfs', input)).toBe(input);
    expect(applyAliasInputDefaults(tool, 'unknown_xyz', input)).toBe(input);
  });
});

describe('六族声明面（与注册表口径一致）', () => {
  const families = [
    {
      make: createVfsFamilyTool,
      name: 'vfs',
      aliases: ['read_vfs', 'write_vfs'],
    },
    {
      make: createSleepFamilyTool,
      name: 'sleep',
      aliases: ['sleep_for', 'sleep_until'],
    },
    {
      make: createSkillFamilyTool,
      name: 'skill',
      aliases: ['skill_view', 'skills_list'],
    },
    {
      make: createCronFamilyTool,
      name: 'cron',
      aliases: ['cron_create', 'cron_delete'],
    },
    {
      make: createWorktreeFamilyTool,
      name: 'worktree',
      aliases: ['enter_worktree', 'exit_worktree'],
    },
    {
      make: createTaskListFamilyTool,
      name: 'task_list',
      aliases: ['create_task_list', 'update_task_status'],
    },
  ] as const;

  for (const family of families) {
    it(`${family.name}：名字 + 旧名 alias + 判别字段`, () => {
      const tool = family.make();
      expect(tool.name).toBe(family.name);
      for (const alias of family.aliases) {
        expect(tool.aliases).toContain(alias);
        expect(LEGACY_ALIAS_TOOL_NAMES as readonly string[]).toContain(alias);
        expect(tool.aliasInputDefaults?.[alias]).toBeDefined();
      }
      const discriminator = tool.params[0]!;
      expect(['op', 'mode']).toContain(discriminator.name);
      expect((discriminator.enum ?? []).length).toBeGreaterThan(1);
    });
  }

  it('注册面：五族默认注册，旧名不再单独注册（`vfs` 受 VFS_ENABLED 门控）', () => {
    const tools = loadTools(new ToolFactory(), getBuiltinToolLoaders());
    const names = new Set(tools.map((t) => t.name));
    for (const name of ['sleep', 'skill', 'cron', 'worktree', 'task_list']) {
      expect(names.has(name)).toBe(true);
    }
    // 默认（VFS_ENABLED=false）⇒ vfs 整族不注册；旧名任何情况下都不是独立注册项
    expect(names.has('vfs')).toBe(false);
    for (const legacy of LEGACY_ALIAS_TOOL_NAMES) {
      expect(names.has(legacy)).toBe(false);
    }
  });
});
