/**
 * 工作空间注册表管理
 * 读写 ~/.pyapp/workspaces.json，维护所有工作空间的名称→路径映射
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import type { WorkspaceRegistry } from './types';
import { resolvePyappHome } from '@modules/core';
import os from 'os';

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
  return join(os.homedir(), 'workspace');
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
async function loadRegistry(): Promise<WorkspaceRegistry> {
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
    return JSON.parse(raw) as WorkspaceRegistry;
  } catch {
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
async function saveRegistry(registry: WorkspaceRegistry): Promise<void> {
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
