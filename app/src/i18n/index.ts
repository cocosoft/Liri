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

import { configManager } from '@modules/config';

/**
 * 国际化 (i18n) 框架
 *
 * 轻量级类型安全的多语言翻译系统。
 * 支持语言检测、运行时切换、变更监听。
 *
 */

/** 支持的语言代码 */
export type LanguageCode = 'zh-CN' | 'en';

/** 翻译模板 — 支持插值变量 {key} */
export type TranslationTemplate = string;

/** 翻译 Schema（嵌套对象） */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TranslationSchema {
  [key: string]: string | TranslationSchema;
}

// ─── 翻译表 ──────────────────────────────────────────────────────────────────

const zhCN: TranslationSchema = {
  common: {
    ok: '确定',
    cancel: '取消',
    yes: '是',
    no: '否',
    loading: '加载中...',
    error: '错误',
    success: '成功',
    warning: '警告',
    retry: '重试',
    close: '关闭',
    save: '保存',
    delete: '删除',
    edit: '编辑',
    search: '搜索',
    back: '返回',
    next: '下一步',
    confirm: '确认',
    unknown: '未知',
    seconds: '秒',
    bytes: '字节',
    enabled: '已启用',
    disabled: '已禁用',
  },
  errors: {
    contextOverflow: '上下文超限，请求了 {requested} tokens',
    contextOverflowTooMany: '请求的 token 过多',
    auth401: '认证失败：{inner}',
    balance402: '余额不足：{inner}',
    badparam422: '参数错误：{inner}',
    badrequest400: '请求错误：{inner}',
    concurrency429: '并发限制，请稍后重试：{inner}',
    upstream5xx: '上游服务 {host} 返回 {status}，请稍后重试',
    deepseek5xxHead: 'DeepSeek 服务返回 {status}，请稍后重试',
    deepseek5xxReachable: '服务可达，可能是临时故障，建议重试',
    deepseek5xxUnreachable: '服务不可达，请检查网络',
    networkError: '网络错误：{message}',
    timeout: '请求超时',
    unknown: '未知错误',
  },
  tools: {
    repairStarted: '工具调用修复已启动',
    repairFlattened: 'Schema 已展平',
    repairScavenged: '从推理内容回收了 {count} 个工具调用',
    repairTruncated: '修复了 {count} 个截断的 JSON',
    repairStorm: '检测到重复调用风暴，已中断',
    callFailed: '工具调用失败：{name}',
    notFound: '工具未找到：{name}',
    permissionDenied: '权限不足：{name}',
  },
  context: {
    foldTriggered: '上下文已折叠（使用率 {ratio}）',
    foldAggressive: '激进折叠已触发（使用率 {ratio}）',
    forceSummary: '强制摘要退出（使用率 {ratio}）',
    foldComplete: '折叠完成：{before} → {after} 条消息',
  },
  mcp: {
    connected: 'MCP 服务器已连接',
    disconnected: 'MCP 服务器已断开',
    reconnecting: '正在重连 MCP 服务器...',
    reconnected: 'MCP 重连成功',
    reconnectFailed: 'MCP 重连失败：{reason}',
    driftDetected: '检测到工具列表变化：{summary}',
    driftIdentity: '工具列表无变化',
    driftAppend: '新增 {count} 个工具',
    driftEdit: '{count} 个工具定义已变更',
    driftRemove: '{count} 个工具已移除',
    driftReorder: '工具顺序已重排',
    serverNotFound: 'MCP 服务器未找到：{name}',
  },
  semantic: {
    indexing: '正在构建语义索引...',
    indexingComplete: '索引构建完成：{chunks} 个分块，{embedded} 个已嵌入',
    indexingFailed: '索引构建失败：{error}',
    searchNoResults: '未找到相关结果',
    searchResults: '找到 {count} 个相关结果',
  },
};

const en: TranslationSchema = {
  common: {
    ok: 'OK',
    cancel: 'Cancel',
    yes: 'Yes',
    no: 'No',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    warning: 'Warning',
    retry: 'Retry',
    close: 'Close',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    search: 'Search',
    back: 'Back',
    next: 'Next',
    confirm: 'Confirm',
    unknown: 'Unknown',
    seconds: 's',
    bytes: 'B',
    enabled: 'Enabled',
    disabled: 'Disabled',
  },
  errors: {
    contextOverflow: 'Context overflow, requested {requested} tokens',
    contextOverflowTooMany: 'Too many tokens requested',
    auth401: 'Authentication failed: {inner}',
    balance402: 'Insufficient balance: {inner}',
    badparam422: 'Invalid parameter: {inner}',
    badrequest400: 'Bad request: {inner}',
    concurrency429: 'Rate limit exceeded, please retry later: {inner}',
    upstream5xx: 'Upstream service {host} returned {status}, please retry later',
    deepseek5xxHead: 'DeepSeek service returned {status}, please retry later',
    deepseek5xxReachable: 'Service is reachable, likely a temporary issue, retry recommended',
    deepseek5xxUnreachable: 'Service is unreachable, please check network',
    networkError: 'Network error: {message}',
    timeout: 'Request timed out',
    unknown: 'Unknown error',
  },
  tools: {
    repairStarted: 'Tool call repair started',
    repairFlattened: 'Schema flattened',
    repairScavenged: 'Recovered {count} tool calls from reasoning content',
    repairTruncated: 'Repaired {count} truncated JSON values',
    repairStorm: 'Repeated call storm detected, interrupted',
    callFailed: 'Tool call failed: {name}',
    notFound: 'Tool not found: {name}',
    permissionDenied: 'Permission denied: {name}',
  },
  context: {
    foldTriggered: 'Context folded (usage {ratio})',
    foldAggressive: 'Aggressive fold triggered (usage {ratio})',
    forceSummary: 'Forced summary exit (usage {ratio})',
    foldComplete: 'Fold complete: {before} → {after} messages',
  },
  mcp: {
    connected: 'MCP server connected',
    disconnected: 'MCP server disconnected',
    reconnecting: 'Reconnecting MCP server...',
    reconnected: 'MCP reconnected successfully',
    reconnectFailed: 'MCP reconnect failed: {reason}',
    driftDetected: 'Tool list drift detected: {summary}',
    driftIdentity: 'Tool list unchanged',
    driftAppend: '{count} tools added',
    driftEdit: '{count} tool definitions changed',
    driftRemove: '{count} tools removed',
    driftReorder: 'Tool order reordered',
    serverNotFound: 'MCP server not found: {name}',
  },
  semantic: {
    indexing: 'Building semantic index...',
    indexingComplete: 'Index build complete: {chunks} chunks, {embedded} embedded',
    indexingFailed: 'Index build failed: {error}',
    searchNoResults: 'No relevant results found',
    searchResults: 'Found {count} relevant results',
  },
};

// ─── 运行时状态 ──────────────────────────────────────────────────────────────

const translations: Record<LanguageCode, TranslationSchema> = {
  'zh-CN': zhCN,
  en,
};

let currentLang: LanguageCode = detectSystemLanguage();

type Listener = () => void;
const listeners: Listener[] = [];

// ─── 公开 API ────────────────────────────────────────────────────────────────

/**
 * 翻译函数
 *
 * @param path 点分隔的翻译路径，如 'errors.contextOverflow'
 * @param vars 插值变量，如 { requested: '1000' }
 * @returns 翻译后的字符串
 *
 * @example
 * t('errors.contextOverflow', { requested: '1000' })
 * // zh-CN: "上下文超限，请求了 1000 tokens"
 * // en: "Context overflow, requested 1000 tokens"
 */
export function t(path: string, vars?: Record<string, string | number>): string {
  const parts = path.split('.');
  let val: unknown = translations[currentLang] || translations['zh-CN'];
  for (const part of parts) {
    val = (val as Record<string, unknown>)?.[part];
    if (val === undefined) break;
  }
  const template = typeof val === 'string' ? val : path;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
}

/**
 * 带计数的翻译（自动处理单复数）
 *
 * @param path 翻译路径
 * @param count 计数
 * @param vars 额外插值变量
 */
export function tn(
  path: string,
  count: number,
  vars?: Record<string, string | number>,
): string {
  return t(path, { ...vars, count: String(count) });
}

/**
 * 设置当前语言
 */
export function setLanguage(lang: LanguageCode): void {
  if (translations[lang]) {
    currentLang = lang;
    notifyListeners();
  }
}

/**
 * 获取当前语言
 */
export function getLanguage(): LanguageCode {
  return currentLang;
}

/**
 * 获取支持的语言列表
 */
export function getSupportedLanguages(): LanguageCode[] {
  return Object.keys(translations) as LanguageCode[];
}

/**
 * 监听语言变更
 *
 * @returns 取消监听的函数
 */
export function onLanguageChange(cb: Listener): () => void {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/**
 * 检测系统语言
 */
export function detectSystemLanguage(): LanguageCode {
  const locale =
    configManager.env('LC_ALL') ||
    configManager.env('LC_MESSAGES') ||
    configManager.env('LANG') ||
    Intl.DateTimeFormat().resolvedOptions().locale;
  if (locale.startsWith('zh')) return 'zh-CN';
  return 'en';
}

// ─── 内部 ────────────────────────────────────────────────────────────────────

function notifyListeners(): void {
  for (const cb of listeners) cb();
}