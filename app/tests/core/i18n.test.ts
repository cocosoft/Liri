/**
 * 国际化（i18n）框架单元测试
 * 覆盖 I18nRegistry、I18nTranslationRegistry、内置翻译
 */

import { describe, it, expect } from 'bun:test';

import { I18nRegistry } from '../../src/system/i18n/registry.js';
import {
  I18nTranslationRegistry,
  initializeBuiltinTranslations,
  getI18nTranslationRegistry,
  t,
} from '../../src/system/i18n/extended.js';
import type { Locale, TranslationMap } from '../../src/system/i18n/types.js';
import type { TranslationEntry } from '../../src/system/i18n/extended.js';

describe('I18nRegistry', () => {

  it('创建实例时使用默认 locale', () => {
    const registry = new I18nRegistry();
    expect(registry.getDefaultLocale()).toBe('en');
  });

  it('创建实例时可指定默认 locale', () => {
    const registry = new I18nRegistry({ defaultLocale: 'zh', fallbackLocales: ['en'] });
    expect(registry.getDefaultLocale()).toBe('zh');
  });

  it('注册单条翻译并正确获取', () => {
    const registry = new I18nRegistry({ defaultLocale: 'zh' });

    registry.registerEntry('zh', 'greeting.hello', '你好');
    expect(registry.t('greeting.hello')).toBe('你好');
  });

  it('注册批量翻译并正确获取', () => {
    const registry = new I18nRegistry({ defaultLocale: 'zh' });

    registry.registerTranslation('zh', {
      greeting: { hello: '你好', world: '世界' },
    });
    expect(registry.t('greeting.hello')).toBe('你好');
    expect(registry.t('greeting.world')).toBe('世界');
  });

  it('缺失 key 返回 key 本身', () => {
    const registry = new I18nRegistry({ defaultLocale: 'zh' });

    expect(registry.t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('参数插值替换', () => {
    const registry = new I18nRegistry({ defaultLocale: 'zh' });

    registry.registerEntry('zh', 'user.greeting', '你好, {name}!');
    expect(registry.t('user.greeting', { name: 'Alice' })).toBe('你好, Alice!');
  });

  it('参数插值 - 缺失参数保留占位符', () => {
    const registry = new I18nRegistry({ defaultLocale: 'zh' });

    registry.registerEntry('zh', 'user.greeting', '你好, {name}!');
    expect(registry.t('user.greeting', {})).toBe('你好, {name}!');
  });

  it('语言回退链 - 请求的 locale 不存在时使用默认 locale', () => {
    const registry = new I18nRegistry({ defaultLocale: 'zh' });

    registry.registerEntry('zh', 'common.ok', '确定');
    expect(registry.t('common.ok', undefined, 'ja')).toBe('确定');
  });

  it('语言回退链 - 按 fallbackLocales 顺序回退', () => {
    const registry = new I18nRegistry({
      defaultLocale: 'en',
      fallbackLocales: ['zh'],
    });

    registry.registerEntry('zh', 'common.ok', '确定');
    registry.registerEntry('en', 'common.ok', 'OK');

    expect(registry.t('common.ok', undefined, 'ja')).toBe('OK');
  });

  it('指定 locale 获取翻译', () => {
    const registry = new I18nRegistry({ defaultLocale: 'zh' });

    registry.registerEntry('zh', 'common.ok', '确定');
    registry.registerEntry('en', 'common.ok', 'OK');

    expect(registry.t('common.ok', undefined, 'en')).toBe('OK');
    expect(registry.t('common.ok', undefined, 'zh')).toBe('确定');
  });

  it('获取支持的 locale 列表', () => {
    const registry = new I18nRegistry();

    registry.registerTranslation('zh', { app: { name: '测试' } });
    registry.registerTranslation('en', { app: { name: 'Test' } });
    registry.registerTranslation('ja', { app: { name: 'テスト' } });

    const locales = registry.getSupportedLocales();
    expect(locales).toContain('zh');
    expect(locales).toContain('en');
    expect(locales).toContain('ja');
    expect(locales.length).toBe(3);
  });

  it('检查翻译是否存在 - hasTranslation', () => {
    const registry = new I18nRegistry({ defaultLocale: 'zh' });

    registry.registerEntry('zh', 'common.ok', '确定');
    expect(registry.hasTranslation('zh', 'common.ok')).toBe(true);
    expect(registry.hasTranslation('zh', 'nonexistent')).toBe(false);
  });

  it('设置默认 locale 后更新翻译源', () => {
    const registry = new I18nRegistry({ defaultLocale: 'zh' });

    registry.registerEntry('zh', 'app.name', '测试应用');
    registry.registerEntry('en', 'app.name', 'Test App');

    expect(registry.t('app.name')).toBe('测试应用');

    registry.setDefaultLocale('en');
    expect(registry.t('app.name')).toBe('Test App');
  });

  it('合并翻译 - 多次注册相同 locale 的翻译会合并（顶层合并）', () => {
    const registry = new I18nRegistry({ defaultLocale: 'zh' });

    registry.registerTranslation('zh', { app: { name: '测试' } });
    registry.registerEntry('zh', 'app.version', '1.0');

    expect(registry.t('app.name')).toBe('测试');
    expect(registry.t('app.version')).toBe('1.0');
  });

  it('嵌套 key 解析', () => {
    const registry = new I18nRegistry({ defaultLocale: 'zh' });

    registry.registerTranslation('zh', {
      menu: {
        file: { new: '新建', open: '打开', save: '保存' },
        edit: { undo: '撤销', redo: '重做' },
      },
    });

    expect(registry.t('menu.file.new')).toBe('新建');
    expect(registry.t('menu.file.open')).toBe('打开');
    expect(registry.t('menu.edit.undo')).toBe('撤销');
  });

});

describe('I18nTranslationRegistry', () => {

  it('注册翻译条目并获取', () => {
    const registry = new I18nTranslationRegistry();

    registry.setLocale('zh');
    registry.register({ key: 'common.ok', zh: '确定', en: 'OK' });
    expect(registry.t('common.ok')).toBe('确定');
  });

  it('切换 locale 后获取对应翻译', () => {
    const registry = new I18nTranslationRegistry();

    registry.register({ key: 'common.ok', zh: '确定', en: 'OK' });
    registry.setLocale('en');
    expect(registry.t('common.ok')).toBe('OK');
  });

  it('缺失 key 返回 key 本身', () => {
    const registry = new I18nTranslationRegistry();

    expect(registry.t('nonexistent')).toBe('nonexistent');
  });

  it('回退 locale - 当前 locale 无翻译时使用 fallback', () => {
    const registry = new I18nTranslationRegistry();

    registry.register({ key: 'common.ok', zh: '确定', en: 'OK' });
    registry.setLocale('ja');
    registry.setFallbackLocale('zh');
    expect(registry.t('common.ok')).toBe('确定');
  });

  it('批量注册翻译条目', () => {
    const registry = new I18nTranslationRegistry();

    registry.setLocale('zh');
    registry.registerBatch([
      { key: 'common.ok', zh: '确定', en: 'OK' },
      { key: 'common.cancel', zh: '取消', en: 'Cancel' },
    ]);

    expect(registry.t('common.ok')).toBe('确定');
    expect(registry.t('common.cancel')).toBe('取消');
  });

  it('参数插值', () => {
    const registry = new I18nTranslationRegistry();

    registry.setLocale('zh');
    registry.register({
      key: 'user.greeting',
      zh: '你好, {name}!',
      en: 'Hello, {name}!',
    });
    expect(registry.t('user.greeting', { name: 'Bob' })).toBe('你好, Bob!');
    expect(registry.t('user.greeting', { name: 'Bob' }, 'en')).toBe('Hello, Bob!');
  });

  it('获取所有翻译键', () => {
    const registry = new I18nTranslationRegistry();

    registry.registerBatch([
      { key: 'a', zh: 'A' },
      { key: 'b', zh: 'B' },
    ] as TranslationEntry[]);
    expect(registry.getKeys()).toEqual(['a', 'b']);
  });

  it('获取翻译统计', () => {
    const registry = new I18nTranslationRegistry();

    registry.registerBatch([
      { key: 'a', zh: 'A中文', en: 'AEnglish' },
      { key: 'b', zh: 'B中文', ja: 'B日本語' },
    ] as TranslationEntry[]);

    const stats = registry.getStats();
    expect(stats.total).toBe(2);
    expect(stats.languages).toContain('zh');
  });

  it('从 JSON 加载翻译', () => {
    const registry = new I18nTranslationRegistry();

    registry.setLocale('zh');
    registry.loadFromJSON({
      'common.ok': { zh: '确定', en: 'OK' },
      'common.cancel': { zh: '取消', en: 'Cancel' },
    });

    expect(registry.t('common.ok')).toBe('确定');
    expect(registry.t('common.cancel', undefined, 'en')).toBe('Cancel');
  });

  it('导出为 JSON', () => {
    const registry = new I18nTranslationRegistry();

    registry.registerBatch([
      { key: 'a', zh: '中文A', en: 'EnglishA' },
      { key: 'b', zh: '中文B', en: 'EnglishB' },
    ]);

    const exported = registry.exportAsJSON('en');
    expect(exported['a']).toBe('EnglishA');
    expect(exported['b']).toBe('EnglishB');
  });

  it('清除所有翻译', () => {
    const registry = new I18nTranslationRegistry();

    registry.setLocale('zh');
    registry.register({ key: 'test', zh: '测试' } as TranslationEntry);
    expect(registry.t('test')).toBe('测试');

    registry.clear();
    expect(registry.t('test')).toBe('test');
  });

});

describe('内置翻译初始化', () => {

  it('initializeBuiltinTranslations 注册常用翻译', () => {
    const registry = new I18nTranslationRegistry();

    registry.setLocale('zh');
    initializeBuiltinTranslations(registry);

    expect(registry.t('common.ok')).toBe('确定');
    expect(registry.t('common.cancel')).toBe('取消');
    expect(registry.t('common.error')).toBe('错误');
  });

  it('内置翻译包含多语言', () => {
    const registry = new I18nTranslationRegistry();

    initializeBuiltinTranslations(registry);

    expect(registry.t('common.ok', undefined, 'en')).toBe('OK');
    expect(registry.t('common.ok', undefined, 'ja')).toBe('OK');
    expect(registry.t('common.ok', undefined, 'ko')).toBe('확인');
  });

  it('内置翻译含参数插值 - cost.usage_summary', () => {
    const registry = new I18nTranslationRegistry();

    initializeBuiltinTranslations(registry);

    const result = registry.t('cost.usage_summary', { cost: '0.05', tokens: '1500' });
    expect(result).toContain('0.05');
    expect(result).toContain('1500');
  });

  it('内置翻译含参数插值 - tool.blocked', () => {
    const registry = new I18nTranslationRegistry();

    initializeBuiltinTranslations(registry);

    const result = registry.t('tool.blocked', { tool: 'exec', reason: '权限不足' });
    expect(result).toContain('exec');
    expect(result).toContain('权限不足');
  });

});

describe('全局单例 i18n', () => {

  it('getI18nTranslationRegistry 返回单例', () => {
    const r1 = getI18nTranslationRegistry();
    const r2 = getI18nTranslationRegistry();

    expect(r1).toBe(r2);
  });

  it('快捷函数 t 使用全局单例', () => {
    const registry = getI18nTranslationRegistry();
    registry.clear();
    registry.setLocale('zh');
    initializeBuiltinTranslations(registry);

    const result = t('common.ok');
    expect(result).toBe('确定');
  });

});
