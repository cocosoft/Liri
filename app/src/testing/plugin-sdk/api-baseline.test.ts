// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * plugin-sdk 契约测试（api-baseline）
 * 2026-08-06：补齐 AGENTS.md:16 声明但缺失的契约测试。
 * 覆盖 plugin-sdk/ 公开 API 的行为基线：core / categories / channel-contract / ManifestLoader。
 * 违反本测试即视为 SDK 公开 API 的破坏性变更，须同步 AGENTS.md 并标注 breaking change。
 */
import { describe, test, expect } from 'bun:test';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createPlugin,
  createServices,
  createPluginContext,
  getInjectedServiceIds,
  validatePluginManifest,
  generatePluginTemplate,
  writePluginTemplate,
  PLUGIN_CATEGORIES,
  getCategoryMeta,
  validateCategory,
  listCategories,
  createProviderPlugin,
  createToolPlugin,
  createChannelPlugin,
  createSkillPlugin,
  validateChannelPlugin,
  loadPluginManifest,
  getPluginSkills,
} from '../../plugin-sdk/index';
import type { PluginManifest } from '../../plugin-sdk/types';

const validManifest: PluginManifest = {
  id: 'hello-plugin',
  name: 'Hello Plugin',
  version: '1.0.0',
  description: 'A demo plugin',
  main: './index.js',
  author: 'demo',
  category: 'tool',
};

describe('plugin-sdk 契约测试', () => {
  describe('createPlugin', () => {
    test('返回符合 SDK 标准的 Plugin 结构', () => {
      const plugin = createPlugin({
        id: 'hello-plugin',
        name: 'Hello Plugin',
        version: '1.0.0',
        description: 'A demo plugin',
        author: 'demo',
        category: 'tool',
        tags: ['test'],
      });

      expect(plugin.id).toBe('hello-plugin');
      expect(plugin.name).toBe('Hello Plugin');
      expect(plugin.version).toBe('1.0.0');
      expect(plugin.category).toBe('tool');
      expect(plugin.tags).toEqual(['test']);
      expect(typeof plugin.initialize).toBe('undefined');
    });

    test('默认 tags 为空数组', () => {
      const plugin = createPlugin({
        id: 'no-tags',
        name: 'No Tags',
        version: '0.1.0',
        description: '',
        author: 'demo',
        category: 'chat',
      });
      expect(plugin.tags).toEqual([]);
    });

    // T3.3: 插件 HMR 契约 —— createPlugin 支持 __hotDispose 可选钩子
    test('支持 __hotDispose 可选钩子（T3.3 HMR 契约）', () => {
      const plugin = createPlugin({
        id: 'hot-plugin',
        name: 'Hot Plugin',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
        __hotDispose: async () => {},
      });
      expect(typeof plugin.__hotDispose).toBe('function');
    });

    // 4.1: 声明式服务注入 —— createPlugin 支持 inject / injectOptional 声明
    test('支持 inject / injectOptional 声明（声明式服务注入）', () => {
      const plugin = createPlugin({
        id: 'inject-plugin',
        name: 'Inject Plugin',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
        inject: ['kernel.configManager'],
        injectOptional: ['kernel.eventSystem'],
      });
      expect(plugin.inject).toEqual(['kernel.configManager']);
      expect(plugin.injectOptional).toEqual(['kernel.eventSystem']);
    });
  });

  describe('声明式服务注入（createServices / createPluginContext / getInjectedServiceIds）', () => {
    test('createServices 提供 get/has/list', () => {
      const services = createServices({
        'kernel.configManager': { name: 'config' },
        'kernel.eventSystem': { name: 'events' },
      });

      expect(services.has('kernel.configManager')).toBe(true);
      expect(services.has('kernel.unknown')).toBe(false);
      expect(services.get('kernel.eventSystem')).toEqual({ name: 'events' });
      expect(services.get('kernel.unknown')).toBeUndefined();
      expect(services.list().sort()).toEqual([
        'kernel.configManager',
        'kernel.eventSystem',
      ]);
    });

    test('createPluginContext 将 services 以参数形式挂载到 context', () => {
      const context = createPluginContext({
        pluginId: 'p1',
        pluginName: 'P1',
        version: '1.0.0',
        services: { 'kernel.configManager': { key: 'v' } },
      });

      expect(context.pluginId).toBe('p1');
      expect(context.services?.get('kernel.configManager')).toEqual({
        key: 'v',
      });
      expect(context.services?.has('kernel.missing')).toBe(false);
    });

    test('createPluginContext 未提供可选字段时使用安全空实现（不抛错）', () => {
      const context = createPluginContext({
        pluginId: 'p2',
        pluginName: 'P2',
        version: '1.0.0',
      });

      expect(() => context.log.info('x')).not.toThrow();
      expect(() => context.events.emit('e')).not.toThrow();
      expect(context.config.get('k', 42)).toBe(42);
      expect(context.services?.list()).toEqual([]);
    });

    test('getInjectedServiceIds 分离必需与可选注入', () => {
      const ids = getInjectedServiceIds({
        inject: ['a', 'b'],
        injectOptional: ['c'],
      });
      expect(ids.required).toEqual(['a', 'b']);
      expect(ids.optional).toEqual(['c']);
    });
  });

  describe('validatePluginManifest', () => {
    test('有效清单返回 valid: true', () => {
      const result = validatePluginManifest(validManifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('缺失 id/name/version/entry 时返回错误', () => {
      const result = validatePluginManifest({} as PluginManifest);
      expect(result.valid).toBe(false);
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain('ERR_MISSING_ID');
      expect(codes).toContain('ERR_MISSING_NAME');
      expect(codes).toContain('ERR_MISSING_VERSION');
      // PY-4：main 字段已废弃为 entry.python/entry.ts 二选一（见 ManifestLoaderEntry.test.ts）
      expect(codes).toContain('ERR_MISSING_ENTRY');
    });

    test('非法 id 返回 ERR_INVALID_ID', () => {
      const result = validatePluginManifest({
        ...validManifest,
        id: 'Bad ID!',
      });
      expect(result.errors.some((e) => e.code === 'ERR_INVALID_ID')).toBe(true);
    });

    test('非语义化版本仅产生警告', () => {
      const result = validatePluginManifest({
        ...validManifest,
        version: 'v1',
      });
      expect(result.valid).toBe(true);
      expect(
        result.warnings.some((w) => w.code === 'WARN_INVALID_VERSION')
      ).toBe(true);
    });

    test('inject 字段必须是字符串数组（非法时报 INVALID_INJECT_FIELD）', () => {
      const bad = validatePluginManifest({
        ...validManifest,
        inject: [42] as unknown as string[],
      });
      expect(bad.valid).toBe(false);
      expect(bad.errors.some((e) => e.code === 'INVALID_INJECT_FIELD')).toBe(
        true
      );

      const badOptional = validatePluginManifest({
        ...validManifest,
        injectOptional: 'kernel.configManager' as unknown as string[],
      });
      expect(badOptional.valid).toBe(false);

      const good = validatePluginManifest({
        ...validManifest,
        inject: ['kernel.configManager'],
        injectOptional: ['kernel.eventSystem'],
      });
      expect(good.valid).toBe(true);
    });
  });

  describe('分类系统（categories）', () => {
    test('PLUGIN_CATEGORIES 覆盖能力枚举', () => {
      const categories = listCategories();
      expect(categories.length).toBeGreaterThan(0);
      for (const c of categories) {
        expect(validateCategory(c)).toBe(true);
        expect(getCategoryMeta(c)).toBeDefined();
      }
    });

    test('validateCategory 拒绝未知能力', () => {
      expect(validateCategory('unknown-category')).toBe(false);
    });

    test('createProviderPlugin 生成带能力标记的插件', () => {
      const plugin = createProviderPlugin({
        id: 'provider-a',
        name: 'Provider A',
        version: '1.0.0',
        description: '',
        author: 'demo',
        providerName: 'openai',
        getModels: () => ['gpt-4o'],
        healthCheck: async () => true,
      });
      expect(plugin.category).toBe('provider');
      expect(plugin.providerName).toBe('openai');
    });

    test('createToolPlugin / createChannelPlugin / createSkillPlugin 分类正确', () => {
      const tool = createToolPlugin({
        id: 'tool-a',
        name: 'Tool A',
        version: '1.0.0',
        description: '',
        author: 'demo',
        toolName: 'tool-a',
        getSchema: () => ({ type: 'object' }),
        execute: async () => ({ ok: true }),
      });
      expect(tool.category).toBe('tool');

      const channel = createChannelPlugin({
        id: 'channel-a',
        name: 'Channel A',
        version: '1.0.0',
        description: '',
        author: 'demo',
        channelName: 'wecom',
        connect: async () => {},
        disconnect: async () => {},
        sendMessage: async () => ({ success: true }),
      });
      expect(channel.category).toBe('channel');

      const skill = createSkillPlugin({
        id: 'skill-a',
        name: 'Skill A',
        version: '1.0.0',
        description: '',
        author: 'demo',
        skillName: 'skill-a',
        getSkillDefinition: () => ({}),
        execute: async () => ({ ok: true }),
      });
      expect(skill.category).toBe('skill');
    });
  });

  describe('通道契约（channel-contract）', () => {
    const validChannelPlugin = {
      id: 'wecom',
      meta: {
        id: 'wecom',
        displayName: 'WeCom',
        vendor: 'demo',
        vendorSite: 'https://example.com',
        icon: 'wecom',
        markdownCapable: true,
        maxMessageLength: 4000,
        supportedMessageTypes: ['text', 'image'] as const,
      },
      capabilities: {
        directMessage: true,
        groupMessage: true,
        groupMention: true,
        threading: false,
        reactions: false,
        interactive: false,
        voiceCall: false,
        fileUpload: true,
        imageMessage: true,
        webhook: true,
      },
      config: {
        validate: () => ({ valid: true, errors: [] }),
        getDefaultConfig: () => ({}),
      },
      lifecycle: {
        connect: async () => {},
        disconnect: async () => {},
        healthCheck: async () => ({ healthy: true, latencyMs: 0 }),
        getStatus: () => ({
          connected: false,
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        }),
      },
      outbound: {
        sendText: async () => ({ success: true }),
        sendMarkdown: async () => ({ success: true }),
        sendImage: async () => ({ success: true }),
        sendFile: async () => ({ success: true }),
        sendInteractive: async () => ({ success: true }),
      },
      security: {
        dmPolicy: 'pairing' as const,
        pairingCodeTimeoutMs: 300000,
        maxPairingAttempts: 5,
        resolveSender: async () => ({
          userId: 'u1',
          displayName: 'U1',
          isApproved: true,
        }),
        authorizeMessage: async () => ({ allowed: true }),
      },
    };

    test('validateChannelPlugin 校验缺 id 的通道插件', () => {
      const { id: _id, ...missingId } = validChannelPlugin;
      const result = validateChannelPlugin(missingId as never);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('缺少 id');
    });

    test('validateChannelPlugin 通过完整通道插件', () => {
      const result = validateChannelPlugin(validChannelPlugin as never);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('清单加载（ManifestLoader）', () => {
    test('loadPluginManifest 对不存在路径返回 manifest: null', () => {
      const result = loadPluginManifest('/nonexistent/plugin.json');
      expect(result.manifest).toBeNull();
      expect(result.validation.valid).toBe(false);
      expect(
        result.validation.errors.some((e) => e.code === 'MANIFEST_NOT_FOUND')
      ).toBe(true);
    });

    test('getPluginSkills 从清单提取技能定义', () => {
      const skills = getPluginSkills({
        ...validManifest,
        skills: [{ id: 's1', name: 'S1', description: 'Skill one' }],
      });
      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe('s1');
    });

    test('loadPluginManifest 从 plugin.json 解析 inject / injectOptional（四格式之一）', () => {
      const dir = mkdtempSync(join(tmpdir(), 'pyapp-inject-test-'));
      try {
        writeFileSync(
          join(dir, 'plugin.json'),
          JSON.stringify({
            id: 'inject-file',
            name: 'Inject File',
            version: '1.0.0',
            description: 'inject test',
            author: 'demo',
            type: 'tool',
            main: './index.js',
            inject: ['kernel.configManager'],
            injectOptional: ['kernel.eventSystem'],
          }),
          'utf8'
        );

        const result = loadPluginManifest(dir);
        expect(result.validation.valid).toBe(true);
        expect(result.manifest?.inject).toEqual(['kernel.configManager']);
        expect(result.manifest?.injectOptional).toEqual(['kernel.eventSystem']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('loadPluginManifest 拒绝非字符串数组的 inject 字段', () => {
      const dir = mkdtempSync(join(tmpdir(), 'pyapp-inject-bad-'));
      try {
        writeFileSync(
          join(dir, 'plugin.json'),
          JSON.stringify({
            id: 'inject-bad',
            name: 'Inject Bad',
            version: '1.0.0',
            description: 'bad inject',
            author: 'demo',
            type: 'tool',
            main: './index.js',
            inject: 'kernel.configManager',
          }),
          'utf8'
        );

        const result = loadPluginManifest(dir);
        expect(result.validation.valid).toBe(false);
        expect(
          result.validation.errors.some(
            (e) => e.code === 'INVALID_INJECT_FIELD'
          )
        ).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('插件脚手架（scaffold，4.5）', () => {
    test('generatePluginTemplate 生成含 inject 声明的模板文件', () => {
      const files = generatePluginTemplate({
        id: 'demo-plugin',
        name: 'Demo Plugin',
        version: '0.1.0',
        description: 'demo',
        author: 'demo',
        category: 'tool',
        inject: ['kernel.configManager'],
        injectOptional: ['kernel.eventSystem'],
      });

      expect(files.map((f) => f.path)).toEqual([
        'package.json',
        'index.js',
        'README.md',
      ]);

      const pkg = JSON.parse(
        files.find((f) => f.path === 'package.json')!.content
      );
      expect(pkg.pyapp.id).toBe('demo-plugin');
      expect(pkg.pyapp.inject).toEqual(['kernel.configManager']);
      expect(pkg.pyapp.injectOptional).toEqual(['kernel.eventSystem']);

      const entry = files.find((f) => f.path === 'index.js')!.content;
      expect(entry).toContain('createPlugin');
      expect(entry).toContain('kernel.configManager');
    });

    test('无效 id 的模板生成被契约自检拒绝', () => {
      expect(() =>
        generatePluginTemplate({
          id: 'Bad ID!',
          name: 'Bad',
          version: '1.0.0',
          description: '',
          author: '',
          category: 'tool',
        })
      ).toThrow(/插件清单校验失败/);
    });

    test('writePluginTemplate 将模板写入目录', () => {
      const dir = mkdtempSync(join(tmpdir(), 'pyapp-scaffold-test-'));
      try {
        const written = writePluginTemplate(dir, {
          id: 'scaffold-plugin',
          name: 'Scaffold Plugin',
          version: '1.0.0',
          description: '',
          author: '',
          category: 'tool',
        });

        expect(written).toContain('package.json');
        expect(existsSync(join(dir, 'package.json'))).toBe(true);
        expect(existsSync(join(dir, 'index.js'))).toBe(true);
        expect(readFileSync(join(dir, 'package.json'), 'utf8')).toContain(
          'scaffold-plugin'
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('公开 API 稳定性基线', () => {
    test('核心 API 全部导出且为函数', () => {
      expect(typeof createPlugin).toBe('function');
      expect(typeof validatePluginManifest).toBe('function');
      expect(typeof getCategoryMeta).toBe('function');
      expect(typeof validateCategory).toBe('function');
      expect(typeof listCategories).toBe('function');
      expect(typeof createProviderPlugin).toBe('function');
      expect(typeof createToolPlugin).toBe('function');
      expect(typeof createChannelPlugin).toBe('function');
      expect(typeof createSkillPlugin).toBe('function');
      expect(typeof validateChannelPlugin).toBe('function');
      expect(typeof loadPluginManifest).toBe('function');
    });

    test('PLUGIN_CATEGORIES 为不可为空的记录', () => {
      expect(typeof PLUGIN_CATEGORIES).toBe('object');
      expect(Object.keys(PLUGIN_CATEGORIES).length).toBeGreaterThan(0);
    });
  });
});
