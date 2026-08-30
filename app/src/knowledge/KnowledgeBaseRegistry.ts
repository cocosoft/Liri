/**
 * 知识库注册表 (KnowledgeBaseRegistry)
 *
 * 管理 ~/.pyapp/knowledge/ 下的知识库元数据。
 * 通过 .pyapp-knowledge.json 文件持久化知识库列表、启用状态、图标等信息。
 * 支持自动扫描目录发现未注册的知识库。
 */

import { join } from 'path';
import { readFile, writeFile, mkdir, readdir, rename, cp } from 'fs/promises';
import { existsSync } from 'fs';
import { getLogger } from '@modules/monitoring';
import { resolvePyappHome } from '@modules/core';
import { SimpleMutex } from '@modules/core';

export interface KnowledgeBaseMeta {
  label: string;
  enabled: boolean;
  icon: string;
  createdAt: number;
  source: 'system' | 'user';
}

export interface KnowledgeBase {
  name: string;
  label: string;
  enabled: boolean;
  docCount: number;
  icon: string;
  createdAt: number;
  source: 'system' | 'user';
}

interface RegistryData {
  version: number;
  bases: Record<string, KnowledgeBaseMeta>;
}

const REGISTRY_VERSION = 1;
const REGISTRY_FILENAME = '.pyapp-knowledge.json';

const logger = getLogger('knowledge:knowledgeBaseRegistry');

export class KnowledgeBaseRegistry {
  private knowledgeRoot: string;
  private registryPath: string;
  private data: RegistryData | null = null;
  private writeMutex = new SimpleMutex();

  constructor() {
    this.knowledgeRoot = join(resolvePyappHome(), 'knowledge');
    this.registryPath = join(this.knowledgeRoot, REGISTRY_FILENAME);
  }

  /**
   * 获取知识库根目录
   */
  getKnowledgeRoot(): string {
    return this.knowledgeRoot;
  }

  /**
   * 重设知识库根目录（运行时迁移 / 测试沙箱隔离）。
   * 同步重设注册表文件路径并失效缓存。
   */
  setKnowledgeRoot(root: string): void {
    this.knowledgeRoot = root;
    this.registryPath = join(root, REGISTRY_FILENAME);
    this.data = null;
  }

  /**
   * 获取注册表文件路径
   */
  getRegistryPath(): string {
    return this.registryPath;
  }

  /**
   * 初始化注册表，确保知识库根目录存在
   */
  private async ensureRoot(): Promise<void> {
    if (!existsSync(this.knowledgeRoot)) {
      await mkdir(this.knowledgeRoot, { recursive: true });
    }
  }

  /**
   * 加载注册表数据，不存在则创建默认
   */
  private async load(): Promise<RegistryData> {
    if (this.data) return this.data;

    await this.ensureRoot();

    if (existsSync(this.registryPath)) {
      try {
        const content = await readFile(this.registryPath, 'utf-8');
        this.data = JSON.parse(content) as RegistryData;
        return this.data;
      } catch (err) {
        logger.warning('知识库注册表解析失败，将重建', {
          error: String(err),
        });
      }
    }

    this.data = await this.createDefaultRegistry();
    await this.persist();
    return this.data;
  }

  /**
   * 创建默认注册表
   */
  private async createDefaultRegistry(): Promise<RegistryData> {
    const now = Date.now();
    const data: RegistryData = {
      version: REGISTRY_VERSION,
      bases: {
        default: {
          label: '默认知识库',
          enabled: true,
          icon: '📚',
          createdAt: now,
          source: 'system',
        },
      },
    };

    await mkdir(join(this.knowledgeRoot, 'default'), { recursive: true });
    return data;
  }

  /**
   * 持久化注册表到文件
   */
  private async persist(): Promise<void> {
    if (!this.data) return;
    await this.ensureRoot();
    await this.writeMutex.acquire();
    try {
      // 原子写入：先写 .tmp，再 rename 替换
      const tmpPath = this.registryPath + '.tmp';
      await writeFile(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      await rename(tmpPath, this.registryPath);
    } finally {
      this.writeMutex.release();
    }
  }

  /**
   * 列出所有知识库，自动发现未注册的目录
   */
  async listBases(): Promise<KnowledgeBase[]> {
    const data = await this.load();
    await this.scanAndRegister(data);
    return this.buildBaseList(data);
  }

  /**
   * 获取已启用的知识库列表（用于 AI 搜索过滤）
   */
  async listActiveBases(): Promise<KnowledgeBase[]> {
    const all = await this.listBases();
    return all.filter((b) => b.enabled);
  }

  /**
   * 获取单个知识库
   */
  async getBase(name: string): Promise<KnowledgeBase | null> {
    const all = await this.listBases();
    return all.find((b) => b.name === name) || null;
  }

  /**
   * 创建新知识库
   */
  async createBase(
    name: string,
    label: string,
    icon?: string
  ): Promise<KnowledgeBase> {
    const data = await this.load();

    if (data.bases[name]) {
      throw new Error(`知识库 "${name}" 已存在`);
    }

    const baseDir = join(this.knowledgeRoot, name);
    await mkdir(baseDir, { recursive: true });

    data.bases[name] = {
      label,
      enabled: true,
      icon: icon || '📁',
      createdAt: Date.now(),
      source: 'user',
    };

    await this.persist();
    this.data = data;

    const docCount = await this.countDocs(name);

    return {
      name,
      label,
      enabled: true,
      docCount,
      icon: icon || '📁',
      createdAt: data.bases[name].createdAt,
      source: 'user',
    };
  }

  /**
   * 更新知识库元数据
   */
  async updateBase(
    name: string,
    updates: Partial<Pick<KnowledgeBaseMeta, 'label' | 'enabled' | 'icon'>>
  ): Promise<KnowledgeBase> {
    const data = await this.load();

    if (!data.bases[name]) {
      throw new Error(`知识库 "${name}" 不存在`);
    }

    if (updates.label !== undefined) data.bases[name].label = updates.label;
    if (updates.enabled !== undefined)
      data.bases[name].enabled = updates.enabled;
    if (updates.icon !== undefined) data.bases[name].icon = updates.icon;

    await this.persist();
    this.data = data;

    const docCount = await this.countDocs(name);

    return {
      name,
      label: data.bases[name].label,
      enabled: data.bases[name].enabled,
      docCount,
      icon: data.bases[name].icon,
      createdAt: data.bases[name].createdAt,
      source: data.bases[name].source,
    };
  }

  /**
   * 删除知识库
   */
  async deleteBase(name: string): Promise<void> {
    const data = await this.load();

    if (!data.bases[name]) {
      throw new Error(`知识库 "${name}" 不存在`);
    }

    delete data.bases[name];

    await this.persist();
    this.data = data;
  }

  /**
   * 获取知识库下文档数量
   */
  async countDocs(baseName: string): Promise<number> {
    const baseDir = join(this.knowledgeRoot, baseName);
    if (!existsSync(baseDir)) return 0;

    try {
      let count = 0;
      const entries = await readdir(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          count++;
        }
      }
      return count;
    } catch {
      return 0;
    }
  }

  /**
   * 扫描 knowledge/ 目录，自动注册未注册的子目录
   */
  private async scanAndRegister(data: RegistryData): Promise<void> {
    if (!existsSync(this.knowledgeRoot)) return;

    let changed = false;
    const entries = await readdir(this.knowledgeRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'raw') continue;
      if (data.bases[entry.name]) continue;

      data.bases[entry.name] = {
        label: entry.name,
        enabled: true,
        icon: '📁',
        createdAt: Date.now(),
        source: 'user',
      };
      changed = true;

      logger.info('自动发现并注册知识库', { name: entry.name });
    }

    if (changed) {
      this.data = data;
      await this.persist();
    }
  }

  /**
   * 构建返回给前端的知识库列表
   */
  private async buildBaseList(data: RegistryData): Promise<KnowledgeBase[]> {
    const result: KnowledgeBase[] = [];

    for (const [name, meta] of Object.entries(data.bases)) {
      const docCount = await this.countDocs(name);
      result.push({
        name,
        label: meta.label,
        enabled: meta.enabled,
        docCount,
        icon: meta.icon,
        createdAt: meta.createdAt,
        source: meta.source,
      });
    }

    result.sort((a, b) => a.createdAt - b.createdAt);
    return result;
  }

  /**
   * 复制知识库配置（仅元数据，不含文件内容）
   *
   * @param source 源知识库名称
   * @param target 目标知识库名称
   */
  async duplicateConfig(
    source: string,
    target: string
  ): Promise<KnowledgeBase> {
    const data = await this.load();

    if (!data.bases[source]) {
      throw new Error(`源知识库 "${source}" 不存在`);
    }
    if (data.bases[target]) {
      throw new Error(`目标知识库 "${target}" 已存在`);
    }

    const sourceMeta = data.bases[source]!;
    data.bases[target] = {
      label: `${sourceMeta.label} (副本)`,
      enabled: sourceMeta.enabled,
      icon: sourceMeta.icon,
      createdAt: Date.now(),
      source: 'user',
    };

    await this.persist();
    this.data = data;
    await this.ensureDir(target);

    logger.info('知识库配置复制完成', { source, target });
    return (await this.getBase(target))!;
  }

  /**
   * 完整克隆知识库（含所有知识文件）
   *
   * @param source 源知识库名称
   * @param target 目标知识库名称
   */
  async cloneBase(source: string, target: string): Promise<KnowledgeBase> {
    const data = await this.load();

    if (!data.bases[source]) {
      throw new Error(`源知识库 "${source}" 不存在`);
    }
    if (data.bases[target]) {
      throw new Error(`目标知识库 "${target}" 已存在`);
    }

    const sourceDir = join(this.knowledgeRoot, source);
    const targetDir = join(this.knowledgeRoot, target);

    if (!existsSync(sourceDir)) {
      throw new Error(`源知识库目录 "${sourceDir}" 不存在`);
    }

    // 复制目录及其全部内容
    await cp(sourceDir, targetDir, { recursive: true });

    // 注册新知识库
    const sourceMeta = data.bases[source]!;
    data.bases[target] = {
      label: `${sourceMeta.label} (克隆)`,
      enabled: sourceMeta.enabled,
      icon: sourceMeta.icon,
      createdAt: Date.now(),
      source: 'user',
    };

    await this.persist();
    this.data = data;

    logger.info('知识库克隆完成', { source, target });
    return (await this.getBase(target))!;
  }

  /**
   * 确保知识库目录存在
   */
  private async ensureDir(baseName: string): Promise<void> {
    const dir = join(this.knowledgeRoot, baseName);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
}

let defaultRegistry: KnowledgeBaseRegistry | null = null;

export function getDefaultKnowledgeBaseRegistry(): KnowledgeBaseRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new KnowledgeBaseRegistry();
  }
  return defaultRegistry;
}
