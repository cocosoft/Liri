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
 * BuiltinEnabledStore
 * 内置技能启用状态持久化（3.5.7）
 *
 * 内置技能由 BundledSkillLoader/FileSkillLoader 纯内存加载，重启后内存态丢失。
 * 为满足"内置技能禁用后重启不复活"，将启用状态持久化为独立小文件
 * `builtin-enabled.json`（与 index.json 同级，位于用户技能目录）。
 */

import { join } from 'path';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { resolveUserSkillsDir } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'skills:builtinEnabled',
  level: LogLevel.INFO,
});

const FILE_NAME = 'builtin-enabled.json';

/** 内置技能启用状态文件路径（与 index.json 同级；dir 参数供测试注入临时目录） */
export function builtinEnabledFilePath(dir?: string): string {
  return join(dir ?? resolveUserSkillsDir(), FILE_NAME);
}

/**
 * 读取内置技能启用状态
 * 返回 Map<skillName, enabled>；文件不存在/损坏时返回空 Map（按默认全部启用）
 */
export function loadBuiltinEnabled(dir?: string): Map<string, boolean> {
  const filePath = builtinEnabledFilePath(dir);
  if (!existsSync(filePath)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<
      string,
      boolean
    >;
    return new Map(Object.entries(raw));
  } catch (error) {
    logger.warn('内置技能启用状态文件损坏，按默认启用处理', error as Error);
    return new Map();
  }
}

/**
 * 原子写内置技能启用状态（temp + rename）
 * @param state 完整状态表（含所有曾切换过的内置技能）
 */
export function persistBuiltinEnabled(
  state: Map<string, boolean>,
  dir?: string
): void {
  const filePath = builtinEnabledFilePath(dir);
  mkdirSync(dir ?? resolveUserSkillsDir(), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  try {
    writeFileSync(
      tmpPath,
      JSON.stringify(Object.fromEntries(state), null, 2),
      'utf-8'
    );
    renameSync(tmpPath, filePath);
  } catch (error) {
    logger.error('内置技能启用状态持久化失败', error as Error);
  }
}
