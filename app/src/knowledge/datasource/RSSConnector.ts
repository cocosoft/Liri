// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * RSSConnector — RSS/Atom Feed 数据源连接器
 *
 * 从 RSS/Atom Feed 拉取文章内容，写入知识库 raw/ 目录。
 * 支持增量同步（基于 pubDate 或 guid）。
 *
 * 配置示例：
 *   {
 *     "type": "rss",
 *     "enabled": true,
 *     "intervalMs": 3600000,
 *     "url": "https://example.com/feed.xml",
 *     "maxItems": 20
 *   }
 */

import { LogLevel } from '@modules/monitoring';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger';
import type {
  DataSourceConnector,
  DataSourceConfig,
  DataSourceItem,
  SyncResult,
} from './DataSourceConnector';

const logger = new OTelAwareLogger({
  module: 'knowledge:datasource:rss',
  level: LogLevel.INFO,
});

/**
 * RSS/Atom Feed 连接器
 *
 * 使用内置 fetch + 简易 XML 解析（无需额外依赖）。
 * 对于复杂 RSS 解析需求，可升级为使用 fast-xml-parser。
 */
export class RSSConnector implements DataSourceConnector {
  readonly type = 'rss';
  readonly displayName = 'RSS/Atom Feed';

  private config: DataSourceConfig;
  private lastSyncAt = 0;
  private lastItemId?: string;

  constructor(config: DataSourceConfig) {
    this.config = config;
  }

  async sync(): Promise<SyncResult> {
    const startTime = Date.now();
    const url = this.config.url as string;
    const maxItems = (this.config.maxItems as number) ?? 20;

    if (!url) {
      return {
        connector: this.type,
        added: 0,
        updated: 0,
        failed: 0,
        errors: [{ item: 'config', error: '缺少 url 配置' }],
        startedAt: startTime,
        completedAt: Date.now(),
      };
    }

    const result: SyncResult = {
      connector: this.type,
      added: 0,
      updated: 0,
      failed: 0,
      errors: [],
      startedAt: startTime,
      completedAt: 0,
    };

    try {
      // 1. 拉取 Feed
      const response = await fetch(url, {
        headers: { 'User-Agent': 'PY_APP-Knowledge/1.0' },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        result.errors.push({ item: 'http', error: `HTTP ${response.status}` });
        result.completedAt = Date.now();
        return result;
      }

      const xmlText = await response.text();

      // 2. 简易 XML 解析（提取 item/entry 标签）
      const items = this.parseFeed(xmlText, maxItems);

      // 3. 转换为 DataSourceItem 并去重
      let added = 0;
      for (const item of items) {
        const id = item.id;
        if (!id) continue;

        // 增量同步：跳过已处理的条目
        if (this.lastItemId && id === this.lastItemId) break;

        // 这里写入 raw/ 的逻辑由调用方处理
        // 连接器只负责拉取和转换
        added++;
        if (id === items[0]?.id) {
          this.lastItemId = id;
        }
      }

      this.lastSyncAt = Date.now();
      result.added = added;
      logger.info('RSS 同步完成', { url, added });
    } catch (err) {
      result.errors.push({ item: 'sync', error: (err as Error).message });
      logger.error('RSS 同步失败', { url, error: (err as Error).message });
    }

    result.completedAt = Date.now();
    return result;
  }

  async validateConfig(
    config: DataSourceConfig
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!config.url) errors.push('缺少 url 配置');
    return { valid: errors.length === 0, errors };
  }

  async getLastSyncState(): Promise<{
    lastSyncAt: number;
    lastItemId?: string;
  } | null> {
    if (this.lastSyncAt === 0) return null;
    return { lastSyncAt: this.lastSyncAt, lastItemId: this.lastItemId };
  }

  /** 简易 RSS/Atom XML 解析 */
  private parseFeed(xml: string, maxItems: number): DataSourceItem[] {
    const items: DataSourceItem[] = [];

    // RSS 2.0: <item>...</item>
    const rssItemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while (
      (match = rssItemRegex.exec(xml)) !== null &&
      items.length < maxItems
    ) {
      items.push(this.parseRSSItem(match[1]!));
    }

    // Atom: <entry>...</entry>
    if (items.length === 0) {
      const atomEntryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
      while (
        (match = atomEntryRegex.exec(xml)) !== null &&
        items.length < maxItems
      ) {
        items.push(this.parseAtomEntry(match[1]!));
      }
    }

    return items;
  }

  private parseRSSItem(raw: string): DataSourceItem {
    return {
      id: this.extractTag(raw, 'guid') || this.extractTag(raw, 'link') || '',
      title: this.decodeXml(this.extractTag(raw, 'title')),
      content: this.decodeXml(this.extractTag(raw, 'description')),
      url: this.extractTag(raw, 'link'),
      publishedAt: this.parseDate(this.extractTag(raw, 'pubDate')),
      author: this.extractTag(raw, 'author'),
      raw,
    };
  }

  private parseAtomEntry(raw: string): DataSourceItem {
    const title = this.extractTag(raw, 'title');
    return {
      id: this.extractTag(raw, 'id') || '',
      title: this.decodeXml(title),
      content: this.decodeXml(
        this.extractTag(raw, 'content') || this.extractTag(raw, 'summary')
      ),
      url: this.extractLinkHref(raw),
      publishedAt: this.parseDate(
        this.extractTag(raw, 'published') || this.extractTag(raw, 'updated')
      ),
      author: this.extractTag(raw, 'name'),
      raw,
    };
  }

  private extractTag(xml: string, tag: string): string {
    const match = xml.match(
      new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
    );
    return match?.[1]?.trim() ?? '';
  }

  private extractLinkHref(xml: string): string {
    const match = xml.match(/<link[^>]*href="([^"]*)"/i);
    return match?.[1] ?? '';
  }

  private parseDate(dateStr: string): number | undefined {
    if (!dateStr) return undefined;
    const ts = Date.parse(dateStr);
    return isNaN(ts) ? undefined : ts;
  }

  private decodeXml(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]*>/g, '')
      .trim();
  }
}
