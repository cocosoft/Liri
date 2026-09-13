/**
 * 语言解析与字体映射共享模块单测（方案 v4 §九）
 * 覆盖：normalizeLang / detectLang / resolveLanguage / LANG_PROFILES 完整性 / cjkFontOf / canUseStandardPdfFont
 */
import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_CN_FONT,
  LANG_PROFILES,
  canUseStandardPdfFont,
  cjkFontOf,
  detectLang,
  normalizeLang,
  resolveLanguage,
} from './languageProfiles';

describe('normalizeLang（别名收敛）', () => {
  test('大小写/短码/别名 → 表内 key', () => {
    expect(normalizeLang('zh')).toBe('zh-CN');
    expect(normalizeLang('zh-cn')).toBe('zh-CN');
    expect(normalizeLang('zh-Hans')).toBe('zh-CN');
    expect(normalizeLang('zh-TW')).toBe('zh-TW');
    expect(normalizeLang('zh-tw')).toBe('zh-TW');
    expect(normalizeLang('en')).toBe('en-US');
    expect(normalizeLang('en-us')).toBe('en-US');
    expect(normalizeLang('en-GB')).toBe('en-US');
    expect(normalizeLang('ja')).toBe('ja-JP');
    expect(normalizeLang('ko-kr')).toBe('ko-KR');
  });

  test('非法值/空值返回 undefined', () => {
    expect(normalizeLang(undefined)).toBeUndefined();
    expect(normalizeLang('')).toBeUndefined();
    expect(normalizeLang('   ')).toBeUndefined();
    expect(normalizeLang('fr-FR')).toBeUndefined();
  });
});

describe('detectLang（纯内容检测，仅兜底用）', () => {
  test('日文含汉字仍判 ja-JP（假名优先）', () => {
    expect(detectLang('日本語テスト')).toBe('ja-JP');
  });
  test('韩文谚文 → ko-KR', () => {
    expect(detectLang('한국어 테스트')).toBe('ko-KR');
  });
  test('注音符号 → zh-TW', () => {
    expect(detectLang('ㄅㄆㄇㄈ 注音')).toBe('zh-TW');
  });
  test('中文 + 全角标点 → zh-CN', () => {
    expect(detectLang('中文内容，全角标点。')).toBe('zh-CN');
  });
  test('纯英文 → en-US', () => {
    expect(detectLang('plain English content')).toBe('en-US');
  });
});

describe('resolveLanguage（参数优先，配置/系统兜底）', () => {
  test('参数语言优先于内容检测', () => {
    expect(resolveLanguage('en-US', '中文内容')).toBe('en-US');
    expect(resolveLanguage('ja-JP', 'English')).toBe('ja-JP');
  });

  test('非法参数值安全 fallback（收敛到表内 key）', () => {
    const result = resolveLanguage('fr-FR', '中文');
    expect(['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'zh-TW']).toContain(result);
  });

  test('未传参数时走系统/内容检测且必返回表内 key', () => {
    const result = resolveLanguage(undefined, '日本語内容');
    expect(['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'zh-TW']).toContain(result);
  });
});

describe('LANG_PROFILES 完整性', () => {
  test('每个已注册语言字段齐全且 pdfFonts 非空', () => {
    for (const key of Object.keys(LANG_PROFILES)) {
      const profile = LANG_PROFILES[key];
      expect(profile.fontName, key).toBeTruthy();
      expect(profile.langTag, key).toBeTruthy();
      expect(profile.pdfFonts.length, key).toBeGreaterThan(0);
    }
  });

  test('覆盖前端已启用语言 zh-CN / en-US', () => {
    expect(LANG_PROFILES['zh-CN']).toBeDefined();
    expect(LANG_PROFILES['en-US']).toBeDefined();
  });
});

describe('cjkFontOf（eastAsia/ea 域字体）', () => {
  test('CJK 语言用自身字体', () => {
    expect(cjkFontOf('zh-CN')).toBe('宋体');
    expect(cjkFontOf('zh-TW')).toBe('PMingLiU');
    expect(cjkFontOf('ja-JP')).toBe('MS Gothic');
    expect(cjkFontOf('ko-KR')).toBe('Malgun Gothic');
  });

  test('非 CJK 语言 fallback 默认中文字体', () => {
    expect(cjkFontOf('en-US')).toBe(DEFAULT_CN_FONT);
  });
});

describe('canUseStandardPdfFont（WinAnsi 免嵌入判定）', () => {
  test('纯 ASCII 可用标准字体', () => {
    expect(canUseStandardPdfFont('Hello, world! 123')).toBe(true);
  });

  test('含全角标点/中文不可用', () => {
    expect(canUseStandardPdfFont('中文，标点。')).toBe(false);
  });

  test('WinAnsi 扩展字符（弯引号/省略号）可编码', () => {
    expect(
      canUseStandardPdfFont('Curly \u201Cquotes\u201D and \u2026 ellipsis')
    ).toBe(true);
  });

  test('WinAnsi 空洞码点（U+0081 等）不可用', () => {
    expect(canUseStandardPdfFont('\u0081')).toBe(false);
  });
});
