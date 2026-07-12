/**
 * MIT License
 * Copyright (c) 2026 Liri
 *
 * 翻译模块共享类型定义
 */

/** 语言代码（ISO 639-1 + 扩展） */
export type LanguageCode = string;

/** 语言检测结果 */
export interface LanguageDetectionResult {
  detectedLanguage: LanguageCode;
  confidence: number;
  autoDetected: boolean;
}

/** 翻译请求（前端 → 后端） */
export interface TranslateRequest {
  text: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  model?: string;
}

/** 翻译结果（后端 → 前端） */
export interface TranslateResult {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  model: string;
  durationMs: number;
  /** 语言检测置信度（0-1），仅自动检测时有值 */
  confidence?: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  createdAt: number;
}

/** 翻译历史记录（DB 行） */
export interface TranslateHistoryRecord {
  id: string;
  groupId: string;
  sourceText: string;
  translatedText: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  model: string;
  durationMs: number;
  usageJson: string | null;
  /** 收藏标星 */
  starred: boolean;
  createdAt: number;
}

/** 翻译历史查询参数 */
export interface TranslateHistoryQuery {
  page?: number;
  pageSize?: number;
  sourceLang?: LanguageCode;
  targetLang?: LanguageCode;
  /** 关键词搜索（LIKE 匹配 source_text 和 translated_text） */
  search?: string;
  /** 仅显示已收藏 */
  starred?: boolean;
}

/** 翻译历史分页响应 */
export interface TranslateHistoryPage {
  records: TranslateHistoryRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/** 后处理结果 */
export interface PostProcessResult {
  cleaned: string;
  appliedStrategies: string[];
  isNonTranslation: boolean;
}

/** 流式翻译 chunk */
export type TranslateStreamChunk =
  | { type: 'token'; token: string }
  | { type: 'done'; result: TranslateResult }
  | { type: 'error'; message: string };
