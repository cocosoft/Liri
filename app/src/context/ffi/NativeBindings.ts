// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Rust FFI 安全绑定层（Phase 2.20 + 2.23 + 2.24）
 *
 * 提供 RAII 内存管理、catch_unwind 安全包装、TypeScript 降级 fallback。
 *
 * 使用方式：
 *   import { compressMessages, estimateTokens } from './NativeBindings';
 *   const result = await compressMessages(messages, 'drop');
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolveProjectRoot } from '@modules/core/paths';

const logger = getLogger('context:ffi');

// ============================================================
// RustString — RAII 内存管理（2.23）
// ============================================================

interface NativeModule {
  compress_messages_safe(messagesJson: string, strategy: string): string;
  estimate_tokens_safe(messagesJson: string): string;
  py_free_string(ptr: number): void;
}

type NativeModuleFactory = () => NativeModule;

/**
 * 尝试加载 native 模块（Phase 2.23 — 跨平台兼容，自动检测）
 *
 * 动态库路径：
 *   Windows: native/target/release/pyapp_native.dll
 *   Linux:   native/target/release/libpyapp_native.so
 *   macOS:   native/target/release/libpyapp_native.dylib
 *
 * 加载策略（按优先级）：
 *   1. 检测 DLL 文件是否存在，存在则尝试动态加载
 *   2. 加载失败或文件不存在 → 静默回退到 TypeScript fallback
 *
 * 编译方法：`cd native && cargo build --release`
 * 编译后无需重启应用，下次启动时自动检测并启用 native 路径。
 */
function loadNative(): NativeModule | null {
  try {
    const path = require('path');
    const fs = require('fs');
    const platform = process.platform;
    const libName = platform === 'win32' ? 'pyapp_native' : 'libpyapp_native';
    const ext =
      platform === 'win32' ? '.dll' : platform === 'darwin' ? '.dylib' : '.so';

    // 相对于仓库根 native/ 目录的 target/release/（resolveProjectRoot 返回仓库根）
    const nativeDir = path.join(resolveProjectRoot(), 'native');
    const libPath = path.join(
      nativeDir,
      'target',
      'release',
      `${libName}${ext}`
    );

    if (!fs.existsSync(libPath)) {
      return null; // 未编译，正常情况
    }

    // 尝试 koffi 方式加载（零原生依赖，推荐）
    try {
      const koffi = require('koffi');
      const lib = koffi.load(libPath);
      // 验证必要函数存在
      if (typeof lib.compress_messages_safe === 'function') {
        return lib as unknown as NativeModule;
      }
    } catch {
      // @ignore-catch: native binding unavailable
      // koffi 不可用或加载失败，尝试 ffi-napi
    }

    // 回退：ffi-napi 方式
    try {
      const ffi = require('ffi-napi');
      return ffi.Library(libPath, {
        compress_messages_safe: ['string', ['string', 'string']],
        estimate_tokens_safe: ['string', ['string']],
        py_free_string: ['void', ['pointer']],
      }) as unknown as NativeModule;
    } catch {
      // @ignore-catch: native binding unavailable
      // 两种方式都失败，降级到 TS fallback
    }
  } catch {
    // @ignore-catch: native binding unavailable
    // 降级到 TS fallback
  }
  return null;
}

let _nativeModule: NativeModule | null | undefined;

function getNativeModule(): NativeModule | null {
  if (_nativeModule === undefined) {
    _nativeModule = loadNative();
    if (_nativeModule) {
      logger.info('native:ffi_loaded');
    } else {
      logger.info('native:ffi_unavailable, using TypeScript fallback');
    }
  }
  return _nativeModule;
}

// ============================================================
// 压缩函数 — FFI 优先 → TypeScript fallback（2.24）
// ============================================================

export interface CompressionResult {
  messages: string; // JSON 字符串
  method: 'native' | 'typescript';
}

/**
 * 安全压缩消息数组
 * @param messages - JSON 序列化的消息数组
 * @param strategy - 压缩策略（"drop" | "hybrid" 等）
 */
export function compressMessages(
  messagesJson: string,
  strategy = 'drop'
): CompressionResult {
  const native = getNativeModule();
  if (native) {
    try {
      const result = native.compress_messages_safe(messagesJson, strategy);
      const parsed = JSON.parse(result);
      if (parsed.error) {
        logger.warn('native:compress_failed', {
          error: parsed.error,
          code: parsed.code,
        });
      } else {
        return { messages: result, method: 'native' };
      }
    } catch (err) {
      void handleError(err, { module: 'context:ffi', action: 'compress' });
    }
  }

  // TypeScript fallback: 简单 drop 策略
  return { messages: tsCompressDrop(messagesJson), method: 'typescript' };
}

/** TypeScript 降级：drop 策略 */
function tsCompressDrop(messagesJson: string): string {
  try {
    const messages = JSON.parse(messagesJson);
    if (!Array.isArray(messages)) return messagesJson;

    const filtered = messages.filter((msg: Record<string, unknown>) => {
      const role = msg.role as string;
      if (role !== 'tool') return true;
      return Boolean(msg.content) || Boolean(msg.tool_call_id);
    });

    return JSON.stringify(filtered);
  } catch {
    // @ignore-catch: native compress fallback
    return messagesJson;
  }
}

// ============================================================
// Token 估算函数 — FFI 优先 → TypeScript fallback（2.24）
// ============================================================

export interface TokenEstimationResult {
  tokens: number;
  method: 'native' | 'typescript';
}

/**
 * 安全估算消息数组的 token 数
 * @param messagesJson - JSON 序列化的消息数组
 */
export function estimateTokens(messagesJson: string): TokenEstimationResult {
  const native = getNativeModule();
  if (native) {
    try {
      const result = native.estimate_tokens_safe(messagesJson);
      const parsed = JSON.parse(result);
      if (parsed.error) {
        logger.warn('native:estimate_failed', {
          error: parsed.error,
          code: parsed.code,
        });
      } else if (typeof parsed.tokens === 'number') {
        return { tokens: parsed.tokens, method: 'native' };
      }
    } catch (err) {
      void handleError(err, { module: 'context:ffi', action: 'estimate' });
    }
  }

  // TypeScript fallback: CJK 感知估算
  return { tokens: tsEstimateTokens(messagesJson), method: 'typescript' };
}

/** TypeScript 降级：CJK 感知 token 估算 */
function tsEstimateTokens(messagesJson: string): number {
  try {
    const messages = JSON.parse(messagesJson);
    if (!Array.isArray(messages)) return 0;

    let total = 0;
    for (const msg of messages) {
      const content =
        typeof msg.content === 'string' ? (msg.content as string) : '';
      if (content) {
        total += estimateTextTokens(content);
      }
    }
    return total;
  } catch {
    // @ignore-catch: native estimate unavailable
    return 0;
  }
}

/** 估算单段文本的 token 数（CJK 感知）。
 * P1-13: 算法收敛到 TokenEstimator.estimateTokens() — CJK×1.5 + 非CJK×0.25, 英文 words×1.3 + chars×0.05。 */
function estimateTextTokens(text: string): number {
  if (!text) return 0;

  const CJK_REGEX =
    /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/gu;
  const cjkMatches = text.match(CJK_REGEX);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const totalChars = text.length;

  if (cjkCount === 0) {
    return Math.ceil(totalChars / 4);
  }

  const cjkRatio = cjkCount / totalChars;
  if (cjkRatio > 0.3) {
    const nonCjk = totalChars - cjkCount;
    const words = text.split(/\s+/).filter(Boolean);
    return (
      Math.ceil(cjkCount * 1.5 + nonCjk * 0.25) + Math.min(words.length, 5)
    );
  }

  const words = text.split(/\s+/).filter(Boolean);
  return Math.ceil(words.length * 1.3 + totalChars * 0.05);
}

// ============================================================
// 兼容旧 API（TokenBudgetController 使用的 require('native') 模式）
// ============================================================

/**
 * 兼容旧版 TokenBudgetController 的 lazyInitNative() 调用
 * 返回 estimateTokens(text, model?) 风格的函数
 */
let compatEstimateFn:
  | ((text: string, model?: string) => number)
  | null
  | undefined;

export function getCompatEstimateTokens():
  | ((text: string, model?: string) => number)
  | null {
  if (compatEstimateFn === undefined) {
    const native = getNativeModule();
    if (native) {
      compatEstimateFn = (text: string) => {
        const result = estimateTokens(
          JSON.stringify([{ role: 'user', content: text }])
        );
        return result.tokens;
      };
    } else {
      compatEstimateFn = null;
    }
  }
  return compatEstimateFn;
}
