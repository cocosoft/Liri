/**
 * ToolGroup + Toolkit 单元测试
 * 验证工具分组和工具包管理功能
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { ToolGroup } from '../ToolGroup';
import { Toolkit } from '../Toolkit';
import { FunctionTool } from '../FunctionTool';

/** 创建用于测试的简单工具 */
function createMockTool(name: string, description: string) {
  return new FunctionTool({
    func: async () => 'ok',
    name,
    description,
  });
}

describe('ToolGroup', () => {
  it('应创建带名称和描述的工具组', () => {
    const group = new ToolGroup('web', 'Web 搜索工具');
    expect(group.name).toBe('web');
    expect(group.description).toBe('Web 搜索工具');
  });

  it('应注册和获取工具', () => {
    const group = new ToolGroup('test', '测试组');
    const tool = createMockTool('search', '搜索工具');
    group.register(tool);
    expect(group.get('search')).toBe(tool);
  });

  it('批量注册工具', () => {
    const group = new ToolGroup('batch', '批量组');
    const tools = [
      createMockTool('t1', '工具1'),
      createMockTool('t2', '工具2'),
      createMockTool('t3', '工具3'),
    ];
    group.registerAll(tools);
    expect(group.size).toBe(3);
    expect(group.list()).toHaveLength(3);
  });

  it('检查是否包含工具', () => {
    const group = new ToolGroup('test', '测试组');
    group.register(createMockTool('finder', '查找工具'));
    expect(group.has('finder')).toBe(true);
    expect(group.has('nonexistent')).toBe(false);
  });

  it('移除工具', () => {
    const group = new ToolGroup('test', '测试组');
    group.register(createMockTool('removable', '可移除工具'));
    expect(group.remove('removable')).toBe(true);
    expect(group.has('removable')).toBe(false);
    expect(group.remove('nonexistent')).toBe(false);
  });

  it('size 返回正确数量', () => {
    const group = new ToolGroup('test', '测试组');
    expect(group.size).toBe(0);
    group.register(createMockTool('a', 'A'));
    expect(group.size).toBe(1);
    group.register(createMockTool('b', 'B'));
    expect(group.size).toBe(2);
  });

  it('toSummary 返回概要信息', () => {
    const group = new ToolGroup('utils', '工具类');
    group.register(createMockTool('echo', '回显'));
    group.register(createMockTool('sleep', '休眠'));
    const summary = group.toSummary();
    expect(summary.name).toBe('utils');
    expect(summary.toolCount).toBe(2);
    expect(summary.toolNames).toContain('echo');
    expect(summary.toolNames).toContain('sleep');
  });
});

describe('Toolkit', () => {
  let toolkit: Toolkit;

  beforeEach(() => {
    toolkit = new Toolkit();
  });

  describe('组注册', () => {
    it('应注册新组', () => {
      const group = new ToolGroup('web', 'Web 工具');
      toolkit.registerGroup(group);
      expect(toolkit.groupCount).toBe(1);
      expect(toolkit.listGroups()).toHaveLength(1);
    });

    it('重复注册应抛出异常', () => {
      const group = new ToolGroup('web', 'Web 工具');
      toolkit.registerGroup(group);
      expect(() => toolkit.registerGroup(group)).toThrow('工具组已存在');
    });

    it('应取消注册组', () => {
      const group = new ToolGroup('web', 'Web 工具');
      toolkit.registerGroup(group);
      expect(toolkit.unregisterGroup('web')).toBe(true);
      expect(toolkit.groupCount).toBe(0);
    });

    it('取消不存在的组返回 false', () => {
      expect(toolkit.unregisterGroup('nonexistent')).toBe(false);
    });
  });

  describe('组激活', () => {
    it('应激活已注册的组', () => {
      const group = new ToolGroup('web', 'Web 工具');
      group.register(createMockTool('search', '搜索'));
      toolkit.registerGroup(group);
      toolkit.activateGroup('web');
      expect(toolkit.isGroupActivated('web')).toBe(true);
    });

    it('激活不存在的组应抛出异常', () => {
      expect(() => toolkit.activateGroup('nonexistent')).toThrow(
        '工具组不存在'
      );
    });

    it('应停用组', () => {
      const group = new ToolGroup('web', 'Web 工具');
      toolkit.registerGroup(group);
      toolkit.activateGroup('web');
      toolkit.deactivateGroup('web');
      expect(toolkit.isGroupActivated('web')).toBe(false);
    });
  });

  describe('工具查找', () => {
    it('只能找到已激活组中的工具', () => {
      const webGroup = new ToolGroup('web', 'Web 工具');
      webGroup.register(createMockTool('web_search', '搜索'));
      toolkit.registerGroup(webGroup);

      const utilGroup = new ToolGroup('utils', '工具类');
      utilGroup.register(createMockTool('calculator', '计算器'));
      toolkit.registerGroup(utilGroup);

      // 未激活时无法找到
      expect(toolkit.findTool('web_search')).toBeUndefined();

      // 激活 web 组后能找到 web_search
      toolkit.activateGroup('web');
      expect(toolkit.findTool('web_search')).toBeDefined();
      expect(toolkit.findTool('calculator')).toBeUndefined();
    });
  });

  describe('获取已激活工具', () => {
    it('应返回所有已激活组的工具', () => {
      const web = new ToolGroup('web', 'Web');
      web.register(createMockTool('s1', 'S1'));
      web.register(createMockTool('s2', 'S2'));
      toolkit.registerGroup(web);

      const utils = new ToolGroup('utils', '工具类');
      utils.register(createMockTool('c1', 'C1'));
      toolkit.registerGroup(utils);

      toolkit.activateGroup('web');
      toolkit.activateGroup('utils');

      const tools = toolkit.getActivatedTools();
      expect(tools).toHaveLength(3);
    });

    it('无激活组时返回空数组', () => {
      const web = new ToolGroup('web', 'Web');
      web.register(createMockTool('s1', 'S1'));
      toolkit.registerGroup(web);
      expect(toolkit.getActivatedTools()).toEqual([]);
    });
  });

  describe('激活组摘要', () => {
    it('应返回已激活组的概要信息', () => {
      const web = new ToolGroup('web', 'Web 工具');
      web.register(createMockTool('search', '搜索'));
      toolkit.registerGroup(web);
      toolkit.activateGroup('web');

      const summaries = toolkit.getActivatedGroupSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].name).toBe('web');
      expect(summaries[0].toolCount).toBe(1);
    });
  });

  describe('重置与清理', () => {
    it('deactivateAll 应停用所有组', () => {
      const web = new ToolGroup('web', 'Web');
      toolkit.registerGroup(web);
      toolkit.activateGroup('web');
      expect(toolkit.activatedCount).toBe(1);

      toolkit.deactivateAll();
      expect(toolkit.activatedCount).toBe(0);
    });

    it('clear 应移除所有组', () => {
      const web = new ToolGroup('web', 'Web');
      toolkit.registerGroup(web);
      expect(toolkit.groupCount).toBe(1);

      toolkit.clear();
      expect(toolkit.groupCount).toBe(0);
      expect(toolkit.activatedCount).toBe(0);
    });
  });
});
