/**
 * `subagent_type` 的 schema 可见面（O18）
 *
 * 锁定两件事：
 * ① 描述**动态生成**，来源与解析链可用值同源（内置 `BUILTIN_AGENTS` + DB 启用角色快照
 *    + 运行时注册）；修复前是静态字符串、只列 6 个内置名 ⇒ 模型**事前**看不到
 *    管理页配置的角色，只在拼错后才从错误文案里得知（N9 / R4）。
 * ② `refreshAvailableSubagentTypeNames()` 的快照 = `AgentRoleStore.listEnabled()` 的角色名
 *    （接线校验：避免快照恒空、描述永远只有内置名 ⇒ 又一个"接了等于没接"）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  AgentTool,
  refreshAvailableSubagentTypeNames,
} from '../../../src/tools/AgentTool/AgentTool';
import {
  renderSubagentTypeDescription,
  setEnabledRoleNames,
  getEnabledRoleNames,
} from '../../../src/tools/AgentTool/AgentDescriptorResolver';
import { BUILTIN_AGENTS } from '../../../src/tools/AgentTool/constants';
import { getAgentRoleStore } from '../../../src/workspace/AgentRoleStore';

const BUILTIN_NAMES = Object.keys(BUILTIN_AGENTS);

/** 取工具实例当前暴露给模型的 `subagent_type` 描述 */
function subagentTypeDescription(tool: AgentTool): string {
  const param = tool.params.find((p) => p.name === 'subagent_type');
  return param?.description ?? '';
}

describe('subagent_type 描述动态生成（O18）', () => {
  beforeEach(() => {
    setEnabledRoleNames([]);
  });

  afterEach(() => {
    setEnabledRoleNames([]);
  });

  test('快照未刷新：只列内置名单（不臆测 DB 角色）', () => {
    const text = renderSubagentTypeDescription({
      builtinTypeNames: BUILTIN_NAMES,
    });

    for (const name of BUILTIN_NAMES) {
      expect(text).toContain(name);
    }
    expect(text).toContain('(builtin)');
    expect(text).not.toContain('Agent 管理页');
  });

  test('快照含 DB 角色 ⇒ 描述可见（模型事前知道能调用）', () => {
    setEnabledRoleNames(['architect', 'security']);

    const text = renderSubagentTypeDescription({
      builtinTypeNames: BUILTIN_NAMES,
    });

    expect(text).toContain('architect');
    expect(text).toContain('security');
    // 三类来源并列，便于模型区分"内置"与"用户配置"
    expect(text).toContain('(builtin)');
    expect(text).toContain('Agent 管理页');
  });

  test('运行时注册名去重列出（与内置重名不重复出现）', () => {
    const text = renderSubagentTypeDescription({
      builtinTypeNames: BUILTIN_NAMES,
      registeredNames: [BUILTIN_NAMES[0], 'plugin-agent'],
    });

    expect(text).toContain('plugin-agent');
    expect(text).toContain('(runtime registered)');
    // 内置名只出现一次（即不在运行时注册段重复）
    expect(text.indexOf(BUILTIN_NAMES[0])).toBe(
      text.lastIndexOf(BUILTIN_NAMES[0])
    );
  });

  test('AgentTool.params 读当前快照 ⇒ 角色变更后无需重建实例', () => {
    const tool = new AgentTool();
    expect(subagentTypeDescription(tool)).not.toContain('architect');

    setEnabledRoleNames(['architect']);

    const text = subagentTypeDescription(tool);
    expect(text).toContain('architect');
    for (const name of BUILTIN_NAMES) {
      expect(text).toContain(name);
    }
  });

  test('refreshAvailableSubagentTypeNames：快照 = DB 启用角色名（接线校验）', async () => {
    const store = getAgentRoleStore();
    await store.init();
    const enabled = await store.listEnabled();

    await refreshAvailableSubagentTypeNames();

    expect([...getEnabledRoleNames()]).toEqual(
      enabled.map((role) => role.agentId)
    );
  });
});
