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
 * 工作空间注册表管理
 * 读写 ~/.pyapp/workspaces.json，维护所有工作空间的名称→路径映射
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import type { WorkspaceRegistryData } from './types';
import { resolvePyappHome } from '@modules/core';
import os from 'os';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'workspaces:registry',
  level: LogLevel.INFO,
});

/**
 * 获取注册表文件路径
 */
function getRegistryPath(): string {
  return join(resolvePyappHome(), 'workspaces.json');
}

/**
 * 获取默认工作空间根目录
 */
export function getDefaultWorkspaceRoot(): string {
  try {
    const { resolveDataSubDir } = require('@modules/core/paths');
    return resolveDataSubDir('workspaces');
  } catch {
    return join(os.homedir(), 'workspace');
  }
}

/**
 * 确保注册表目录存在
 */
async function ensureRegistryDir(): Promise<void> {
  const dir = dirname(getRegistryPath());
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * 加载注册表
 */
async function loadRegistry(): Promise<WorkspaceRegistryData> {
  const filePath = getRegistryPath();
  if (!existsSync(filePath)) {
    return {
      workspaces: {},
      defaultRoot: getDefaultWorkspaceRoot(),
      activeWorkspace: null,
    };
  }
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as WorkspaceRegistryData;
  } catch (err) {
    void handleError(err instanceof Error ? err : new Error(String(err)), {
      module: 'workspaces:registry',
      action: 'loadRegistry',
    });
    logger.error('工作空间注册表读取失败', { error: String(err) });
    return {
      workspaces: {},
      defaultRoot: getDefaultWorkspaceRoot(),
      activeWorkspace: null,
    };
  }
}

/**
 * 保存注册表
 */
async function saveRegistry(registry: WorkspaceRegistryData): Promise<void> {
  await ensureRegistryDir();
  await writeFile(getRegistryPath(), JSON.stringify(registry, null, 2), 'utf8');
}

/**
 * 列出所有工作空间名称→路径
 */
export async function listAll(): Promise<Record<string, string>> {
  const registry = await loadRegistry();
  return registry.workspaces;
}

/**
 * 查找工作空间路径
 * @param name 工作空间名称
 * @returns 路径，未找到返回 null
 */
export async function findByName(name: string): Promise<string | null> {
  const registry = await loadRegistry();
  return registry.workspaces[name] ?? null;
}

/**
 * 注册新工作空间
 * @param name 工作空间名称
 * @param path 工作空间路径
 */
export async function register(name: string, path: string): Promise<void> {
  const registry = await loadRegistry();
  registry.workspaces[name] = path;
  await saveRegistry(registry);
}

/**
 * 注销工作空间
 * @param name 工作空间名称
 */
export async function unregister(name: string): Promise<void> {
  const registry = await loadRegistry();
  delete registry.workspaces[name];
  if (registry.activeWorkspace === name) {
    registry.activeWorkspace = null;
  }
  await saveRegistry(registry);
}

/**
 * 重命名注册表中的工作空间
 * @param oldName 旧名称
 * @param newName 新名称
 * @param newPath 新路径
 */
export async function rename(
  oldName: string,
  newName: string,
  newPath: string
): Promise<void> {
  const registry = await loadRegistry();
  delete registry.workspaces[oldName];
  registry.workspaces[newName] = newPath;
  if (registry.activeWorkspace === oldName) {
    registry.activeWorkspace = newName;
  }
  await saveRegistry(registry);
}

/**
 * 获取当前活动工作空间名称
 */
export async function getActive(): Promise<string | null> {
  const registry = await loadRegistry();
  return registry.activeWorkspace;
}

/**
 * 设置活动工作空间
 * @param name 工作空间名称，null 表示取消活动
 */
export async function setActive(name: string | null): Promise<void> {
  const registry = await loadRegistry();
  registry.activeWorkspace = name;
  await saveRegistry(registry);
}

/**
 * 获取默认工作空间根目录
 */
export async function getDefaultRoot(): Promise<string> {
  const registry = await loadRegistry();
  return registry.defaultRoot;
}
