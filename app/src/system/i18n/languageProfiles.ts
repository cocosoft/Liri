/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * 文档生成多语言支持 — 语言解析与字体映射共享模块（方案 v4）
 *
 * 职责：
 *   1. 语言解析：normalizeLang / detectLang / resolveLanguage（参数 → 配置 → 系统 → 内容检测）
 *   2. 字体映射：LANG_PROFILES（语言 → 字体 / langTag / PDF 字体候选）
 *   3. PDF 判定：canUseStandardPdfFont（WinAnsi 免嵌入）
 *
 * 使用：DocGenerateTool（docx/xlsx/pptx/html）与 PDFTool（pdf）共用，禁止重复实现。
 */

import { configManager } from '@modules/config';
import { detectSystemLocale } from '@modules/system/i18n/extended';

/** 已注册语言（与前端 config.language 枚举一致） */
export const SUPPORTED_LANGS = new Set([
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja-JP',
  'ko-KR',
]);

/** 收敛后的语言 key */
export type LangKey = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP' | 'ko-KR';

/** 短码/别名映射：navigator.language 值、大小写变体 → 表内 key（en-GB 收敛 en-US，拼写差异不影响渲染） */
export const LANG_ALIASES: Record<string, string> = {
  zh: 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hant': 'zh-TW',
  'zh-tw': 'zh-TW',
  en: 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-US',
  ja: 'ja-JP',
  'ja-jp': 'ja-JP',
  ko: 'ko-KR',
  'ko-kr': 'ko-KR',
};

/** 语言规范化：大小写/短码/别名 → 表内 key；未知或空值返回 undefined */
export function normalizeLang(lang: string | undefined): LangKey | undefined {
  if (!lang) return undefined;
  const trimmed = lang.trim();
  if (!trimmed) return undefined;
  if (SUPPORTED_LANGS.has(trimmed)) return trimmed as LangKey;
  return LANG_ALIASES[trimmed.toLowerCase()] as LangKey | undefined;
}

/** 内容语言检测（谚文/假名优先于汉字，注音符号区分繁体；仅兜底用） */
export function detectLang(content: string): LangKey {
  const hasHangul = /[\uac00-\ud7af]/.test(content);
  if (hasHangul) return 'ko-KR';
  const hasKana = /[\u3040-\u30ff]/.test(content);
  if (hasKana) return 'ja-JP'; // 日文内容常含汉字（日本語），假名优先
  const hasBopomofo = /[\u3100-\u312f]/.test(content);
  if (hasBopomofo) return 'zh-TW'; // 注音符号 → 繁体
  const hasHan = /[\u2e80-\u9fff]/.test(content);
  if (hasHan || /[\u3000-\u303f\uff00-\uffef]/.test(content)) return 'zh-CN';
  return 'en-US';
}

/**
 * 解析生成语言：工具参数 → 通用设置 config.language → 系统语言 → 内容检测。
 * 最终收敛到表内 key，杜绝未注册语言导致的 undefined 访问。
 */
export function resolveLanguage(
  paramLanguage: string | undefined,
  content: string
): LangKey {
  if (paramLanguage) {
    const n = normalizeLang(paramLanguage);
    if (n) return n;
  }
  try {
    const configured = configManager.getConfigValue<string>('language');
    if (configured) {
      const n = normalizeLang(configured);
      if (n) return n;
    }
  } catch {
    // 配置读取异常 → 继续走系统/内容兜底
  }
  const system = normalizeLang(detectSystemLocale());
  if (system) return system;
  return detectLang(content);
}

/** PDF 嵌入字体候选（path 探测存在性，fontName 为该文件内部 PostScript 名） */
export interface PdfFontCandidate {
  path: string;
  fontName: string;
}

/** 语言配置档案 */
export interface LanguageProfile {
  /** OOXML/HTML 默认字体（latin 域 / font-family 主字体） */
  fontName: string;
  /** HTML lang / OOXML w:lang / 提示词注入值（前端枚举原值） */
  langTag: string;
  /** PDF 嵌入字体候选（按序探测） */
  pdfFonts: PdfFontCandidate[];
  /** PDF 是否可免嵌入（仅当内容纯 WinAnsi 可编码时生效） */
  pdfStandard?: boolean;
}

/** 语言 → 字体/langTag/PDF 字体映射（Windows/Linux/macOS 候选路径） */
export const LANG_PROFILES: Record<string, LanguageProfile> = {
  'zh-CN': {
    fontName: '宋体',
    langTag: 'zh-CN',
    pdfFonts: [
      { path: 'C:\\Windows\\Fonts\\simhei.ttf', fontName: 'SimHei' }, // 单 TTF，嵌入兼容最好
      { path: 'C:\\Windows\\Fonts\\simsun.ttc', fontName: 'SimSun' }, // 与 docx 宋体同族（字型统一可选方案）
      { path: 'C:\\Windows\\Fonts\\msyh.ttc', fontName: 'Microsoft YaHei' },
      {
        path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        fontName: 'NotoSansCJKsc',
      },
      {
        path: '/System/Library/Fonts/PingFang.ttc',
        fontName: 'PingFangSC-Regular',
      },
    ],
  },
  'zh-TW': {
    fontName: 'PMingLiU',
    langTag: 'zh-TW',
    pdfFonts: [
      { path: 'C:\\Windows\\Fonts\\pmingliu.ttc', fontName: 'PMingLiU' }, // 与 docx fontName 一致
      { path: 'C:\\Windows\\Fonts\\mingliu.ttc', fontName: 'MingLiU' },
      {
        path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        fontName: 'NotoSansCJKtc',
      },
      {
        path: '/System/Library/Fonts/PingFang.ttc',
        fontName: 'PingFangTC-Regular',
      },
    ],
  },
  'en-US': {
    fontName: 'Times New Roman',
    langTag: 'en-US',
    pdfStandard: true,
    pdfFonts: [
      // 混排/非 WinAnsi 时降级嵌入
      { path: 'C:\\Windows\\Fonts\\msyh.ttc', fontName: 'Microsoft YaHei' }, // Win7+ 系统预装，中文混排可靠 fallback
      { path: 'C:\\Windows\\Fonts\\arialuni.ttf', fontName: 'ArialUnicodeMS' }, // 需 Office，非系统预装
      {
        path: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        fontName: 'LiberationSans',
      },
      {
        path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        fontName: 'NotoSansCJKsc',
      },
    ],
  },
  'ja-JP': {
    fontName: 'MS Gothic',
    langTag: 'ja-JP',
    pdfFonts: [
      { path: 'C:\\Windows\\Fonts\\msgothic.ttc', fontName: 'MS-Gothic' },
      { path: 'C:\\Windows\\Fonts\\meiryo.ttc', fontName: 'Meiryo' },
      {
        path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        fontName: 'NotoSansCJKjp',
      },
      {
        path: '/System/Library/Fonts/Hiragino Sans GB.ttc',
        fontName: 'HiraginoSansGB-W3',
      },
    ],
  },
  'ko-KR': {
    fontName: 'Malgun Gothic',
    langTag: 'ko-KR',
    pdfFonts: [
      { path: 'C:\\Windows\\Fonts\\malgun.ttf', fontName: 'MalgunGothic' },
      {
        path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        fontName: 'NotoSansCJKkr',
      },
      {
        path: '/System/Library/Fonts/AppleSDGothicNeo.ttc',
        fontName: 'AppleSDGothicNeo-Regular',
      },
    ],
  },
};

/** 默认中文字体（单一来源；位于表定义之后，避免 const TDZ） */
export const DEFAULT_CN_FONT = LANG_PROFILES['zh-CN'].fontName;

/** CJK 语言（eastAsia/ea 域用自身字体；非 CJK 语言 fallback 默认中文字体） */
const CJK_LANGS = new Set(['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR']);

/**
 * eastAsia/ea 域字体解析：CJK 语言用自身 fontName（PMingLiU / MS Gothic / Malgun Gothic），
 * 仅非 CJK 语言（如 en-US）fallback 默认中文字体（宋体），保证中文内容混排正确。
 */
export function cjkFontOf(lang: string): string {
  return CJK_LANGS.has(lang)
    ? (LANG_PROFILES[lang]?.fontName ?? DEFAULT_CN_FONT)
    : DEFAULT_CN_FONT;
}

/** WinAnsi（CP1252）0x80–0x9F 区段的有效 Unicode 码点（0xA0–0xFF 为 Latin-1 补充，另行判断） */
const WINANSI_EXT = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/**
 * PDF 标准 14 字体（Helvetica，WinAnsi 编码）是否可覆盖全部内容字符。
 * 判定：无 CJK/假名/谚文/全角，且每个字符可被 WinAnsi 编码（显式字符集，排除 0x81/0x8D/0x8F/0x90/0x9D 空洞）。
 */
export function canUseStandardPdfFont(content: string): boolean {
  for (const ch of content) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20) continue; // 控制字符
    if (code <= 0x7e) continue; // ASCII 可打印
    if (code >= 0xa0 && code <= 0xff) continue; // Latin-1 补充
    if (WINANSI_EXT.has(code)) continue; // CP1252 特殊符号
    return false;
  }
  return true;
}
