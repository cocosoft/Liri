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
 * 模型目录 / 迁移路径安全检查（原 `LlamaCppServerManager` 的路径安全簇）
 *
 * 由 `LlamaCppServerManager.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §35）：`FORBIDDEN_DIRS` +
 * `getForbiddenPaths` + `isPathWithin` + `validateModelsDir` + `ensureSafeMigrationPath`。
 *
 * ⚠️ **只搬不改**：逻辑逐字保留。宿主经再导出保持 `validateModelsDir` /
 * `ensureSafeMigrationPath` 的既有 import 路径不变（`MigrationSafety.test.ts` 依赖）。
 */

import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join, normalize, resolve } from 'path';

/** 跨平台禁止作为模型目录的系统路径 */
const FORBIDDEN_DIRS: Record<string, string[]> = {
  win32: [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
    'C:\\Users\\All Users',
  ],
  darwin: ['/System', '/Library', '/Applications', '/private', '/dev'],
  linux: [
    '/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/boot',
    '/dev',
    '/proc',
    '/sys',
    '/run',
    '/var',
  ],
};

/**
 * 获取当前平台禁止的路径列表
 */
function getForbiddenPaths(): string[] {
  return FORBIDDEN_DIRS[process.platform] || [];
}

/**
 * 检查路径是否在父目录内（安全检查）
 */
function isPathWithin(parent: string, child: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  return (
    resolvedChild.startsWith(resolvedParent + require('path').sep) ||
    resolvedChild === resolvedParent
  );
}

/**
 * 校验模型目录是否有效
 * @param dir 目录路径
 * @returns 校验结果
 */
export function validateModelsDir(dir: string): {
  valid: boolean;
  errors: string[];
  resolvedPath?: string;
} {
  const errors: string[] = [];

  if (!dir || typeof dir !== 'string') {
    return { valid: false, errors: ['目录路径不能为空'] };
  }

  try {
    // 规范化路径
    const normalized = normalize(dir);
    const resolved = resolve(normalized);

    // 检查是否为禁止路径
    const forbiddenPaths = getForbiddenPaths();
    for (const forbidden of forbiddenPaths) {
      if (resolved === forbidden || isPathWithin(forbidden, resolved)) {
        errors.push(`禁止将模型目录设置到系统路径: ${forbidden}`);
        return { valid: false, errors };
      }
    }

    // 尝试创建目录（如不存在）
    if (!existsSync(resolved)) {
      try {
        mkdirSync(resolved, { recursive: true });
      } catch (err) {
        errors.push(`无法创建目录: ${resolved}`);
        return { valid: false, errors };
      }
    }

    // 检查是否为目录
    const stat = statSync(resolved);
    if (!stat.isDirectory()) {
      errors.push(`路径不是目录: ${resolved}`);
      return { valid: false, errors };
    }

    // 测试写入权限（创建临时文件然后删除）
    const testFile = join(resolved, `.llama-test-${Date.now()}`);
    try {
      writeFileSync(testFile, 'test');
      unlinkSync(testFile);
    } catch (err) {
      errors.push(`目录不可写: ${resolved}`);
      return { valid: false, errors };
    }

    return { valid: true, errors: [], resolvedPath: resolved };
  } catch (err) {
    errors.push(`路径检查失败: ${(err as Error).message}`);
    return { valid: false, errors };
  }
}

/**
 * 确保迁移路径安全
 * @param targetPath 目标路径
 * @param sourceDir 源目录
 * @returns 安全的目标路径
 */
export function ensureSafeMigrationPath(
  targetPath: string,
  sourceDir: string
): {
  valid: boolean;
  errors: string[];
  safePath?: string;
} {
  const errors: string[] = [];

  try {
    // 1. 规范化并解析路径
    const normalizedTarget = normalize(targetPath);
    const resolvedTarget = resolve(normalizedTarget);
    const resolvedSource = resolve(normalize(sourceDir));

    // 2. 检查目标是否为源或源的子目录
    if (resolvedTarget === resolvedSource) {
      errors.push('目标目录与源目录相同');
      return { valid: false, errors };
    }

    if (isPathWithin(resolvedSource, resolvedTarget)) {
      errors.push('目标目录不能是源目录的子目录');
      return { valid: false, errors };
    }

    // 3. 检查是否为禁止路径
    const forbiddenPaths = getForbiddenPaths();
    for (const forbidden of forbiddenPaths) {
      if (
        resolvedTarget === forbidden ||
        isPathWithin(forbidden, resolvedTarget)
      ) {
        errors.push(`禁止迁移到系统路径: ${forbidden}`);
        return { valid: false, errors };
      }
    }

    // 4. 校验目录有效性
    const validation = validateModelsDir(resolvedTarget);
    if (!validation.valid) {
      return { valid: false, errors: validation.errors };
    }

    return { valid: true, errors: [], safePath: resolvedTarget };
  } catch (err) {
    errors.push(`路径检查失败: ${(err as Error).message}`);
    return { valid: false, errors };
  }
}
