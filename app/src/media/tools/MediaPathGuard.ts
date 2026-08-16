// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * MediaPathGuard — 路径安全守卫
 *
 * 所有 Media 工具在接收文件路径输入时，必须通过此守卫校验，
 * 防止 AI 传入越权路径（路径穿越、系统目录等）。
 */

import { resolve } from 'path';
import {
  resolveMediaDir,
  resolveOutputDir,
  resolveAttachmentsDir,
  isPathWithin,
} from '@modules/core/paths';

/** 允许的基础目录 */
const ALLOWED_BASE_DIRS = [
  resolveMediaDir(),
  resolveOutputDir(),
  resolveAttachmentsDir(),
];

/** 禁止的路径模式 */
const FORBIDDEN_PATTERNS = [
  /\.\./, // 路径穿越
  /^[A-Z]:\\(Windows|System32|Program Files)/i, // Windows 系统目录
  /\/etc\//, // Unix 系统目录
  /\/dev\//, // Unix 设备
  /\/proc\//, // Unix 进程
];

export interface PathCheckResult {
  valid: boolean;
  path?: string;
  error?: string;
}

/**
 * 校验并标准化路径
 * @param inputPath 用户/AI 传入的路径
 * @returns 校验结果，valid=true 时 path 为标准化绝对路径
 */
export function resolveSafePath(inputPath: string): PathCheckResult {
  if (!inputPath || typeof inputPath !== 'string') {
    return { valid: false, error: '路径不能为空' };
  }

  const normalized = resolve(inputPath);

  // 1. 检测路径穿越
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized) || pattern.test(inputPath)) {
      return { valid: false, error: `路径包含禁止模式: ${pattern}` };
    }
  }

  // 2. 校验是否在允许的基础目录内
  // BUG-4 修复：startsWith(resolve(base)) 无路径边界，base="media" 会误放行
  // "media2/x"（前缀碰撞）。改用 isPathWithin（带分隔符边界保护）。
  const isAllowed = ALLOWED_BASE_DIRS.some((base) =>
    isPathWithin(base, normalized)
  );

  if (!isAllowed) {
    return {
      valid: false,
      error: `路径不在允许的目录范围内: ${normalized}`,
    };
  }

  return { valid: true, path: normalized };
}
