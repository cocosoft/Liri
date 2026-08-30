// MIT License
// Copyright (c) 2026 190615273@qq.com
// 技能系统缺陷修复单测（T1/T2/T3a/T3b/T4，2026-08-30，对标 hermes-agent 方案 v2）
// 覆盖：注入幂等去重（metadata + 内容级）、展示=可执行、SkillTool 动态描述、
//       ToolLazyWrapper 穿透、注入块截断保护

import { describe, it, expect } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';

import { SkillRegistry } from '../../src/skills/SkillRegistry';
import { SkillInjectionService } from '../../src/skills/services/SkillInjectionService';
import {
  SkillSource,
  SkillLoadMethod,
  type Skill,
} from '../../src/skills/types';
import { SkillTool } from '../../src/tools/SkillTool/SkillTool';
import { ToolLazyWrapper } from '../../src/tools/utils/ToolLazyWrapper';
import { LazyModuleLoader } from '../../src/core/utils/LazyModuleLoader';
import { truncateApiMessages } from '../../src/chat/services/MessageContextPipeline';
import type {
  Tool,
  ToolInfo,
  ToolUseContext,
} from '../../src/tools/types/Tool';
import type { ToolResult } from '../../src/tools/types/ToolResult';

function makePromptSkill(name: string): Skill {
  return {
    name,
    description: `desc of ${name}`,
    source: SkillSource.THIRD_PARTY,
    loadMethod: SkillLoadMethod.ADAPTER,
    loadedFrom: 'test',
    impl: {
      kind: 'prompt',
      getPromptForCommand: async () => [
        { type: 'text', text: `prompt of ${name}` },
      ],
    },
  };
}

function makeExecutableSkill(name: string): Skill {
  return {
    name,
    description: `desc of ${name}`,
    source: SkillSource.THIRD_PARTY,
    loadMethod: SkillLoadMethod.ADAPTER,
    loadedFrom: 'test',
    impl: { kind: 'executable', execute: async () => undefined },
  };
}

/** 构造隔离的 SkillInjectionService（禁快照缓存 + 临时路径） */
function makeInjectionService(registry: SkillRegistry): SkillInjectionService {
  return new SkillInjectionService(registry, {
    enableSnapshotCache: false,
    snapshotCachePath: join(tmpdir(), `skills-snapshot-${Math.random()}.json`),
  });
}

describe('T1 注入幂等去重（BUG-5）', () => {
  it('连续多次注入历史中恒 1 个注入块', async () => {
    const registry = new SkillRegistry();
    registry.register(makePromptSkill('alpha'));
    registry.register(makePromptSkill('beta'));
    const svc = makeInjectionService(registry);
    await svc.refreshAll();

    const base = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '真实用户消息' },
    ];
    const once = svc.injectSkillsIntoMessageHistory(base);
    const twice = svc.injectSkillsIntoMessageHistory(once);
    const thrice = svc.injectSkillsIntoMessageHistory(twice);

    for (const result of [once, twice, thrice]) {
      const injections = result.filter(
        (m) =>
          (m.metadata as Record<string, unknown> | undefined)
            ?.__skills_injection === true ||
          (typeof m.content === 'string' &&
            m.content.includes('<available_skills>'))
      );
      expect(injections.length).toBe(1);
    }
    expect(thrice.length).toBe(base.length + 1);
  });

  it('内容级兜底：metadata 丢失时按 <available_skills> 特征去重（M-5）', async () => {
    const registry = new SkillRegistry();
    registry.register(makePromptSkill('alpha'));
    const svc = makeInjectionService(registry);
    await svc.refreshAll();

    // 模拟 compaction 丢失 metadata 透传：注入块只剩内容特征、无标记
    const legacyBlock = {
      role: 'user',
      content:
        '<available_skills><skill><name>alpha</name></skill></available_skills>',
    };
    const base = [
      { role: 'system', content: 'sys' },
      legacyBlock,
      { role: 'user', content: '真实用户消息' },
    ];
    const result = svc.injectSkillsIntoMessageHistory(base);
    const injections = result.filter(
      (m) =>
        typeof m.content === 'string' &&
        m.content.includes('<available_skills>')
    );
    expect(injections.length).toBe(1); // 旧块被去重，仅剩新注入块
  });
});

describe('T2 展示=可执行（BUG-2）', () => {
  it('refreshAll 仅激活 prompt 型技能，executable 型不注入', async () => {
    const registry = new SkillRegistry();
    registry.register(makePromptSkill('prompt-a'));
    registry.register(makeExecutableSkill('exec-b'));
    registry.register(makePromptSkill('prompt-c'));
    const svc = makeInjectionService(registry);
    await svc.refreshAll();

    const names = svc.getActiveSkills().map((s) => s.name);
    expect(names).toContain('prompt-a');
    expect(names).toContain('prompt-c');
    expect(names).not.toContain('exec-b'); // 不可执行技能不注入
  });
});

describe('T3b SkillTool 动态描述（BUG-6）', () => {
  it('getInfo 描述包含已注册 prompt 技能名清单', async () => {
    // 动态 import 避免顶层循环依赖（systemPromptSections 构造 SkillRegistry 的 TDZ）
    const { skillRegistry } =
      await import('../../src/constants/systemPromptSections');
    // 向全局 registry 注册临时技能，测完清理（避免污染其他用例）
    try {
      skillRegistry.register(makePromptSkill('zz-fix-test-skill'));
      const tool = new SkillTool();
      // 等待惰性 registry 预热（SkillTool 首次 getInfo 触发异步 import）
      await new Promise((r) => setTimeout(r, 30));
      const info = tool.getInfo();
      expect(info.description).toContain('Execute a registered skill');
      expect(info.description).toContain('zz-fix-test-skill');
      // 技能名可从 available_skills 获取的提示
      expect(info.description).toContain('<available_skills>');
    } finally {
      if (skillRegistry.has('zz-fix-test-skill')) {
        skillRegistry.unregister('zz-fix-test-skill');
      }
    }
  });

  it('描述恒以 Execute a registered skill 开头（静态或带清单）', async () => {
    const tool = new SkillTool();
    await new Promise((r) => setTimeout(r, 30));
    expect(
      tool.getInfo().description.startsWith('Execute a registered skill')
    ).toBe(true);
  });
});

describe('T3a ToolLazyWrapper 穿透（P0-1）', () => {
  class FakeTool implements Tool {
    name = 'fake';
    description = 'static-desc';
    params = [];
    getInfo(): ToolInfo {
      return {
        name: 'fake',
        description: 'dynamic-desc',
        params: [],
        enabled: true,
        readOnly: false,
        destructive: false,
        concurrencySafe: true,
        deferred: false,
        alwaysLoad: false,
      };
    }
    isEnabled(): boolean {
      return true;
    }
    isReadOnly(): boolean {
      return false;
    }
    isDestructive(): boolean {
      return false;
    }
    isConcurrencySafe(): boolean {
      return true;
    }
    async execute(_i: unknown): Promise<ToolResult<unknown>> {
      return { toolCallId: '', toolName: 'fake', result: null };
    }
  }

  it('未加载返回注册快照，已加载委托真实实例 getInfo', async () => {
    const realTool = new FakeTool();
    const loader = new LazyModuleLoader<Tool>(() => realTool);
    const wrapper = new ToolLazyWrapper(
      {
        name: 'fake',
        description: 'static-desc',
        params: [],
        enabled: true,
        readOnly: false,
        destructive: false,
        concurrencySafe: true,
        deferred: false,
        alwaysLoad: false,
      },
      loader
    );

    // 未加载 → 静态快照
    expect(wrapper.getInfo().description).toBe('static-desc');

    // 加载后 → 委托真实实例 getInfo（动态最新）
    await wrapper.execute({});
    expect(wrapper.getInfo().description).toBe('dynamic-desc');
  });
});

describe('T4 注入块截断保护（BUG-4）', () => {
  it('上下文超限截断时注入块不被第一遍丢弃', async () => {
    const longMsg = (role: string, content: string) => ({
      role,
      content,
    });
    const apiMessages = [
      { role: 'system', content: 'system prompt' },
      {
        role: 'user',
        content:
          '<available_skills><skill><name>alpha</name></skill></available_skills>',
        metadata: { __skills_injection: true },
      },
      // 超长旧消息（第一遍"优先丢长消息"应删除它即达标）
      longMsg('user', '超长旧消息'.repeat(200)),
      longMsg('assistant', '旧回复'.repeat(5)),
      longMsg('user', '旧消息'.repeat(5)),
      { role: 'user', content: '最近指令' },
    ];

    // 预算 200：第一遍删除超长旧消息（≈1200 tokens）后剩余
    // system + 注入块 + 短消息 + 最近指令 ≈ 100 tokens < SAFE_LIMIT(170)，
    // **不触发第二遍"极端超限丢注入块"兜底**——验证第一遍保护注入块。
    await truncateApiMessages(apiMessages, 200, new Map(), 's1');

    const injections = apiMessages.filter(
      (m) =>
        (m.metadata as Record<string, unknown> | undefined)
          ?.__skills_injection === true ||
        (typeof m.content === 'string' &&
          m.content.includes('<available_skills>'))
    );
    // 注入块保留（第一遍保护）；最近指令也应保留
    expect(injections.length).toBeGreaterThanOrEqual(1);
    expect(
      apiMessages.some(
        (m) => typeof m.content === 'string' && m.content === '最近指令'
      )
    ).toBe(true);
  });
});
