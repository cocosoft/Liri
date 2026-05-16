/**
 * 工作空间文件操作
 * 管理 ~/workspace/ 下的物理目录和 .workspace.json 元数据
 */
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
  rm,
  rename,
} from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { WorkspaceMeta, WorkspaceEntry } from './types';
import { listAll, getActive, getDefaultRoot } from './WorkspaceRegistry';

/**
 * 生成工作空间唯一ID
 */
function generateId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * 创建工作空间目录和元数据
 * @param name 工作空间名称
 * @returns 工作空间完整路径
 */
export async function createWorkspace(
  name: string,
  description: string = ''
): Promise<string> {
  const root = await getDefaultRoot();

  if (!existsSync(root)) {
    await mkdir(root, { recursive: true });
  }

  const wsPath = join(root, name);

  if (existsSync(wsPath)) {
    throw new Error(`工作空间 "${name}" 已存在 (${wsPath})`);
  }

  await mkdir(wsPath, { recursive: true });

  const now = new Date().toISOString();
  const meta: WorkspaceMeta = {
    id: `ws_${generateId()}`,
    name,
    createdAt: now,
    updatedAt: now,
    description,
  };

  const metaPath = join(wsPath, '.workspace.json');
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  const readmeContent = `# ${name}\n\n${description || '任务说明待补充'}\n\n创建时间: ${now}\n`;
  await writeFile(join(wsPath, 'README.md'), readmeContent, 'utf8');

  return wsPath;
}

/**
 * 读取工作空间元数据
 * @param wsPath 工作空间路径
 * @returns 元数据，失败返回 null
 */
export async function readMeta(wsPath: string): Promise<WorkspaceMeta | null> {
  const metaPath = join(wsPath, '.workspace.json');
  if (!existsSync(metaPath)) {
    return null;
  }
  try {
    const raw = await readFile(metaPath, 'utf8');
    return JSON.parse(raw) as WorkspaceMeta;
  } catch {
    return null;
  }
}

/**
 * 更新工作空间元数据
 * @param wsPath 工作空间路径
 * @param updates 要更新的字段
 */
export async function updateMeta(
  wsPath: string,
  updates: Partial<Pick<WorkspaceMeta, 'name' | 'description'>>
): Promise<WorkspaceMeta | null> {
  const meta = await readMeta(wsPath);
  if (!meta) return null;

  if (updates.name !== undefined) meta.name = updates.name;
  if (updates.description !== undefined) meta.description = updates.description;
  meta.updatedAt = new Date().toISOString();

  const metaPath = join(wsPath, '.workspace.json');
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  return meta;
}

/**
 * 统计工作空间内的文件数（不含 .workspace.json）
 * @param wsPath 工作空间路径
 * @returns 文件数
 */
export async function countFiles(wsPath: string): Promise<number> {
  if (!existsSync(wsPath)) return 0;
  try {
    const entries = await readdir(wsPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name !== '.workspace.json')
      .length;
  } catch {
    return 0;
  }
}

/**
 * 获取工作空间最后修改时间
 * @param wsPath 工作空间路径
 * @returns 修改时间的 ISO 字符串
 */
export async function getLastModified(wsPath: string): Promise<string> {
  try {
    const s = await stat(wsPath);
    return s.mtime.toISOString();
  } catch {
    return '';
  }
}

/**
 * 构建工作空间条目列表
 * @returns 所有工作空间条目
 */
export async function buildEntries(): Promise<WorkspaceEntry[]> {
  const all = await listAll();
  const activeName = await getActive();
  const entries: WorkspaceEntry[] = [];

  for (const name of Object.keys(all)) {
    const wsPath = all[name];
    if (!existsSync(wsPath)) continue;

    const meta = await readMeta(wsPath);
    if (!meta) continue;

    const fileCount = await countFiles(wsPath);

    entries.push({
      name,
      path: wsPath,
      meta,
      fileCount,
      isActive: name === activeName,
    });
  }

  entries.sort(
    (a, b) =>
      new Date(b.meta.updatedAt).getTime() -
      new Date(a.meta.updatedAt).getTime()
  );

  return entries;
}

/**
 * 删除工作空间目录
 * @param wsPath 工作空间路径
 */
export async function deleteWorkspace(wsPath: string): Promise<void> {
  if (!existsSync(wsPath)) {
    throw new Error(`工作空间路径不存在: ${wsPath}`);
  }
  await rm(wsPath, { recursive: true, force: true });
}

/**
 * 重命名工作空间目录
 * @param oldPath 旧路径
 * @param newPath 新路径
 */
export async function renameWorkspace(
  oldPath: string,
  newPath: string
): Promise<void> {
  if (!existsSync(oldPath)) {
    throw new Error(`工作空间路径不存在: ${oldPath}`);
  }
  if (existsSync(newPath)) {
    throw new Error(`目标路径已存在: ${newPath}`);
  }
  await rename(oldPath, newPath);
}
