/**
 * RemoteSkillHubAdapter
 * 配置驱动的远程技能市场适配器
 *
 * 通过配置数组管理多个远程源（Anthropic Skills、LobeHub、OpenAI 等），
 * 无需为每个源创建独立适配器。
 *
 * 设计理念：
 * - 一个适配器实例管理多个远程市场源
 * - 新增市场只需改配置，不改代码
 * - 搜索时并行查询所有配置源
 * - 安装时根据 skillId 前缀（hubId/）定位对应源
 */

import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { SkillSource, SkillLoadMethod } from '@modules/skills/types';
import type { Skill } from '@modules/skills/types';
import { BaseThirdPartyAdapter } from './BaseThirdPartyAdapter';
import type { ThirdPartySkillSearchResult } from './ThirdPartySkillAdapter';
import type { InstalledThirdPartySkill, ThirdPartySkillMeta } from './types';
import { checkSsrf } from '../../../tools/WebFetchTool/ssrf';

const logger = new Logger({
  module: 'skills:remoteHubAdapter',
  level: LogLevel.INFO,
});

/** 目录下存储的元数据文件名 */
const SKILL_MD_FILENAME = 'SKILL.md';
const META_FILENAME = 'meta.json';

/**
 * 远程源配置
 */
export interface RemoteHubConfig {
  /** 源标识，如 'liri-official', 'anthropic-skills' */
  id: string;
  /** 显示名称 */
  name: string;
  /** 技能目录 index.json 的 URL */
  catalogUrl: string;
  /** SKILL.md 下载的 base URL */
  skillBaseUrl: string;
  /** 回退源 URL 列表（如 Gitee 镜像） */
  fallbackUrls?: string[];
}

/**
 * 远程目录条目（index.json 中每项的结构）
 */
interface CatalogEntry {
  /** 技能 ID */
  id: string;
  /** 技能名称 */
  name: string;
  /** 版本号 */
  version: string;
  /** 简短描述 */
  description: string;
  /** 作者 */
  author: string;
  /** 许可证 */
  license?: string;
  /** 分类 */
  category?: string;
  /** 标签 */
  tags?: string[];
  /** 图标（可选） */
  icon?: string;
}

/**
 * 远程目录结构
 */
interface SkillCatalog {
  /** 目录版本 */
  version: string;
  /** 更新时间（ISO 字符串） */
  updatedAt: string;
  /** 技能列表 */
  skills: CatalogEntry[];
}

/**
 * 全限定 skillId 的分隔符
 * 格式: <hubId>/<skillId>
 */
const SKILL_ID_SEPARATOR = '/';

/**
 * 远程技能内部存储格式
 * 继承自 InstalledThirdPartySkill，额外携带 hubId
 */
interface RemoteSkillData extends InstalledThirdPartySkill {
  /** 所属源标识 */
  hubId: string;
}

/**
 * 远程技能市场适配器
 *
 * 配置驱动，通过配置数组管理多个远程市场源。
 * 继承 BaseThirdPartyAdapter，实现 5 个抽象方法。
 */
export class RemoteSkillHubAdapter extends BaseThirdPartyAdapter<RemoteSkillData> {
  /** 适配器唯一标识 */
  readonly name = 'remote-hub-adapter';

  /** 适配器显示名称 */
  readonly displayName = '远程技能市场';

  /** 远程源配置列表 */
  private hubConfigs: RemoteHubConfig[];

  /** 缓存：hubId → CatalogEntry[] */
  private catalogCache: Map<string, CatalogEntry[]> = new Map();

  /** 缓存过期时间（毫秒） */
  private cacheTtlMs: number;

  /** 上次缓存更新时间 */
  private lastCacheUpdate = 0;

  /**
   * @param hubConfigs 远程源配置数组
   * @param cacheTtlMs 目录缓存 TTL（默认 5 分钟）
   */
  constructor(hubConfigs: RemoteHubConfig[], cacheTtlMs = 300_000) {
    super({});
    this.hubConfigs = hubConfigs;
    this.cacheTtlMs = cacheTtlMs;
  }

  // ============================================================
  // 覆盖 getSource() — 根据配适器返回统一起源
  // ============================================================

  /**
   * 获取技能来源标识
   * 统一返回 SkillSource.THIRD_PARTY
   */
  override getSource(): SkillSource {
    return SkillSource.THIRD_PARTY;
  }

  // ============================================================
  // 工具方法
  // ============================================================

  /**
   * 从全限定 skillId 中提取 hubId
   * 格式: <hubId>/<skillId>
   */
  private parseQualifiedId(qualifiedId: string): {
    hubId: string;
    skillId: string;
  } {
    const sepIndex = qualifiedId.indexOf(SKILL_ID_SEPARATOR);
    if (sepIndex === -1) {
      // 无前缀：默认使用第一个 hub
      return {
        hubId: this.hubConfigs[0]?.id ?? 'unknown',
        skillId: qualifiedId,
      };
    }
    return {
      hubId: qualifiedId.slice(0, sepIndex),
      skillId: qualifiedId.slice(sepIndex + 1),
    };
  }

  /**
   * 构造全限定 skillId
   */
  private makeQualifiedId(hubId: string, skillId: string): string {
    return `${hubId}${SKILL_ID_SEPARATOR}${skillId}`;
  }

  /**
   * 刷新目录缓存（若过期）
   */
  private async refreshCatalogCache(): Promise<void> {
    const now = Date.now();
    if (
      now - this.lastCacheUpdate < this.cacheTtlMs &&
      this.catalogCache.size > 0
    ) {
      return;
    }

    this.catalogCache.clear();

    await Promise.all(
      this.hubConfigs.map(async (config) => {
        try {
          const catalog = await this.fetchCatalog(config);
          this.catalogCache.set(config.id, catalog);
          logger.debug(`已加载目录: ${config.name} (${catalog.length} 个技能)`);
        } catch (error) {
          logger.warn(`加载目录失败: ${config.name}`, error as Error);
          this.catalogCache.set(config.id, []);
        }
      })
    );

    this.lastCacheUpdate = now;
  }

  /**
   * 从远程获取目录
   */
  private async fetchCatalog(config: RemoteHubConfig): Promise<CatalogEntry[]> {
    const urls = [config.catalogUrl, ...(config.fallbackUrls ?? [])];

    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        if (!response.ok) {
          logger.warn(`目录请求失败: ${url} (HTTP ${response.status})`);
          continue;
        }

        const catalog: SkillCatalog = await response.json();

        if (!catalog.skills || !Array.isArray(catalog.skills)) {
          logger.warn(`目录格式无效: ${url}`);
          continue;
        }

        return catalog.skills;
      } catch (error) {
        logger.warn(`获取目录失败: ${url}`, error as Error);
        continue;
      }
    }

    return [];
  }

  /**
   * 从远程目录查找指定技能
   */
  private findInCatalog(
    hubId: string,
    skillId: string
  ): CatalogEntry | undefined {
    const entries = this.catalogCache.get(hubId);
    if (!entries) return undefined;
    return entries.find((e) => e.id === skillId);
  }

  // ============================================================
  // 抽象方法实现
  // ============================================================

  /**
   * 将内部技能格式转换为统一 Skill 类型
   */
  protected toSkill(internal: RemoteSkillData): Skill {
    return {
      name: internal.meta.name,
      description: internal.meta.description,
      source: SkillSource.THIRD_PARTY,
      loadMethod: SkillLoadMethod.ADAPTER,
      loadedFrom: `remote-hub:${internal.hubId}`,
      version: internal.meta.version,
      author: internal.meta.author,
      impl: {
        kind: 'prompt',
        getPromptForCommand: async () => [],
      },
      manifest: {
        name: internal.meta.name,
        description: internal.meta.description,
        category: internal.meta.category,
        tags: internal.meta.tags,
        author: internal.meta.author,
        version: internal.meta.version,
      },
    };
  }

  /**
   * 将内部技能格式转换为搜索结果
   */
  protected toSearchResult(
    internal: RemoteSkillData
  ): ThirdPartySkillSearchResult {
    return {
      id: this.makeQualifiedId(internal.hubId, internal.meta.id),
      name: internal.meta.name,
      version: internal.meta.version,
      description: internal.meta.description,
      author: internal.meta.author,
      license: internal.meta.license,
      category: internal.meta.category,
      tags: internal.meta.tags,
      installed: internal.enabled,
    };
  }

  /**
   * 执行安装（下载 SKILL.md 并保存到本地）
   * @param _targetPath 兼容 BaseThirdPartyAdapter 抽象签名（此适配器未启用，忽略）
   */
  protected async doInstall(
    skillId: string,
    sourceUrl?: string,
    _targetPath?: string
  ): Promise<RemoteSkillData> {
    const { hubId, skillId: rawId } = this.parseQualifiedId(skillId);
    const config = this.hubConfigs.find((c) => c.id === hubId);

    if (!config) {
      throw new Error(`未知的远程源: ${hubId}`);
    }

    // S0-3：rawId 净化 —— 拦截 .. / 绝对路径（否则可穿越写出）
    if (
      !rawId ||
      rawId.includes('..') ||
      rawId.startsWith('/') ||
      /^[a-zA-Z]:/.test(rawId)
    ) {
      throw new Error(`非法技能 ID: ${skillId}`);
    }

    // S0-3：用户提供的 sourceUrl 必须通过 SSRF 校验（内网/环回/元数据拦截）
    if (sourceUrl) {
      const ssrfResult = await checkSsrf(sourceUrl);
      if (ssrfResult.blocked) {
        throw new Error(
          `技能源地址被安全策略拦截（SSRF）: ${ssrfResult.reason}`
        );
      }
    }

    // 从目录中获取技能信息
    const catalogEntry = this.findInCatalog(hubId, rawId);
    if (!catalogEntry) {
      throw new Error(`技能未在目录中找到: ${skillId}`);
    }

    // 确定下载 URL
    const urls = sourceUrl
      ? [sourceUrl]
      : [
          `${config.skillBaseUrl}/${rawId}/${SKILL_MD_FILENAME}`,
          ...(config.fallbackUrls?.map(
            (fallback) => `${fallback}/${rawId}/${SKILL_MD_FILENAME}`
          ) ?? []),
        ];

    // 尝试下载 SKILL.md
    let skillMdContent: string | null = null;
    let usedUrl = '';

    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        if (response.ok) {
          skillMdContent = await response.text();
          usedUrl = url;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!skillMdContent) {
      throw new Error(`下载技能文件失败: ${skillId}`);
    }

    // 创建安装目录（S0-3：复用 getSkillInstallPath 替换 :/\ 非法字符）
    const installDir = this.localStore.getSkillInstallPath(rawId);
    if (!existsSync(installDir)) {
      mkdirSync(installDir, { recursive: true });
    }

    // 保存 SKILL.md
    writeFileSync(join(installDir, SKILL_MD_FILENAME), skillMdContent, 'utf-8');

    // 保存元数据
    const metaJson = JSON.stringify(
      {
        ...catalogEntry,
        hubId,
        installedAt: Date.now(),
        sourceUrl: usedUrl,
      },
      null,
      2
    );
    writeFileSync(join(installDir, META_FILENAME), metaJson, 'utf-8');

    const now = Date.now();

    return {
      meta: {
        id: this.makeQualifiedId(hubId, rawId),
        name: catalogEntry.name,
        version: catalogEntry.version,
        description: catalogEntry.description,
        author: catalogEntry.author,
        license: catalogEntry.license,
        category: catalogEntry.category,
        tags: catalogEntry.tags,
      },
      hubId,
      installPath: installDir,
      installedAt: now,
      updatedAt: now,
      enabled: true,
      files: [SKILL_MD_FILENAME, META_FILENAME],
      sourceUrl: usedUrl,
    };
  }

  /**
   * 执行卸载（删除本地文件）
   */
  protected async doUninstall(skill: RemoteSkillData): Promise<void> {
    const { skillId: rawId } = this.parseQualifiedId(skill.meta.id);
    // S0-3：卸载前净化 rawId，防穿越删除
    if (
      !rawId ||
      rawId.includes('..') ||
      rawId.startsWith('/') ||
      /^[a-zA-Z]:/.test(rawId)
    ) {
      throw new Error(`非法技能 ID: ${rawId}`);
    }
    const installDir = this.localStore.getSkillInstallPath(rawId);

    if (!existsSync(installDir)) {
      logger.warn(`技能目录不存在，跳过: ${installDir}`);
      return;
    }

    // 使用 Bun/Node 原生 rm 递归删除
    const { rmSync } = await import('fs');
    rmSync(installDir, { recursive: true, force: true });

    logger.info(`技能目录已删除: ${installDir}`);
  }

  /**
   * 远程搜索（查询所有配置源的目录）
   * @param _opts 兼容 BaseThirdPartyAdapter 抽象签名（此适配器未启用，忽略）
   */
  protected async doSearchRemote(
    query: string,
    _opts?: { category?: string; tags?: string[]; source?: string }
  ): Promise<ThirdPartySkillSearchResult[]> {
    await this.refreshCatalogCache();

    const q = query.toLowerCase();
    const results: ThirdPartySkillSearchResult[] = [];

    for (const [hubId, entries] of this.catalogCache.entries()) {
      const config = this.hubConfigs.find((c) => c.id === hubId);

      for (const entry of entries) {
        // 关键字匹配
        const matches =
          !q ||
          entry.name.toLowerCase().includes(q) ||
          entry.description.toLowerCase().includes(q) ||
          entry.tags?.some((t) => t.toLowerCase().includes(q)) ||
          entry.category?.toLowerCase().includes(q);

        if (!matches) continue;

        // 检查本地是否已安装
        const installed = await this.localStore.getSkill(
          this.makeQualifiedId(hubId, entry.id)
        );

        results.push({
          id: this.makeQualifiedId(hubId, entry.id),
          name: entry.name,
          version: entry.version,
          description: entry.description,
          author: entry.author,
          license: entry.license,
          category: entry.category,
          tags: entry.tags,
          score: q ? this.calcScore(entry, q) : 0.5,
          installed: !!installed,
        });
      }
    }

    // 按相关度排序
    results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return results;
  }

  /**
   * 计算技能与查询的相关度分数
   */
  private calcScore(entry: CatalogEntry, query: string): number {
    let score = 0;
    const q = query.toLowerCase();

    // 名称匹配权重最高
    if (entry.name.toLowerCase() === q) score += 10;
    else if (entry.name.toLowerCase().startsWith(q)) score += 5;
    else if (entry.name.toLowerCase().includes(q)) score += 3;

    // 标签匹配
    if (entry.tags?.some((t) => t.toLowerCase() === q)) score += 4;
    else if (entry.tags?.some((t) => t.toLowerCase().includes(q))) score += 2;

    // 描述匹配
    if (entry.description.toLowerCase().includes(q)) score += 1;

    // 分类匹配
    if (entry.category?.toLowerCase() === q) score += 3;
    else if (entry.category?.toLowerCase().includes(q)) score += 1;

    return score;
  }
}
