/**
 * MediaTemplates
 * 媒体模板预设持久化层（Phase 2）
 *
 * 对标 Grok I2I2V 模板轮播：
 *   - i2i: 图生图（Chibi, Comic, Anime）
 *   - i2i2v: 图生图再生视频（Showcase, Cinematic, Laser）
 */

// @ts-ignore — bun:sqlite 是 Bun 内置模块
import { Database } from 'bun:sqlite';
import { resolveDbPath } from '@modules/core/paths';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'media:templates',
});

/** 模板记录 */
export interface MediaTemplateRecord {
  templateId: string;
  name: string;
  type: 'i2i' | 'i2i2v';
  category: string;
  thumbnailUrl?: string;
  promptTemplate?: string;
  requiresImage: boolean;
  sortOrder: number;
  enabled: boolean;
}

/** 模板种子数据（对标 Grok） */
const SEED_TEMPLATES: MediaTemplateRecord[] = [
  {
    templateId: 'chibi',
    name: 'Chibi',
    type: 'i2i',
    category: '动漫',
    thumbnailUrl: '',
    promptTemplate: '把这张图转为 Q 版 Chibi 风格，大头小身体，可爱',
    requiresImage: true,
    sortOrder: 1,
    enabled: true,
  },
  {
    templateId: 'comic',
    name: 'Comic Book',
    type: 'i2i',
    category: '漫画',
    thumbnailUrl: '',
    promptTemplate: '美式漫画风格，粗线条，饱和色彩，网点阴影',
    requiresImage: true,
    sortOrder: 2,
    enabled: true,
  },
  {
    templateId: 'anime',
    name: 'Anime',
    type: 'i2i',
    category: '动漫',
    thumbnailUrl: '',
    promptTemplate: '日系动漫风格，柔和光线，赛璐珞上色',
    requiresImage: true,
    sortOrder: 3,
    enabled: true,
  },
  {
    templateId: 'showcase',
    name: '产品展示',
    type: 'i2i2v',
    category: '特效',
    thumbnailUrl: '',
    promptTemplate: '产品展示视频，360 度平滑环绕旋转，柔和光照',
    requiresImage: true,
    sortOrder: 4,
    enabled: true,
  },
  {
    templateId: 'cinematic',
    name: '电影运镜',
    type: 'i2i2v',
    category: '电影',
    thumbnailUrl: '',
    promptTemplate: '电影级运镜，缓慢推近，浅景深，电影色调',
    requiresImage: true,
    sortOrder: 5,
    enabled: true,
  },
  {
    templateId: 'laser',
    name: '激光雕刻',
    type: 'i2i2v',
    category: '特效',
    thumbnailUrl: '',
    promptTemplate: '激光雕刻效果，从左上角逐帧显现，金属质感',
    requiresImage: true,
    sortOrder: 6,
    enabled: true,
  },
];

export class MediaTemplates {
  private db: Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath || resolveDbPath());
    this.ensureTable();
    this.seed();
  }

  /** 创建 media_templates 表 */
  private ensureTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS media_templates (
        template_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('i2i', 'i2i2v')),
        category TEXT,
        thumbnail_url TEXT,
        prompt_template TEXT,
        requires_image INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  /** 播种种子数据（使用 INSERT OR IGNORE 避免重复） */
  private seed(): void {
    const inserted = this.db
      // @ts-ignore
      .prepare(
        `INSERT OR IGNORE INTO media_templates
          (template_id, name, type, category, thumbnail_url, prompt_template, requires_image, sort_order, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

    for (const tmpl of SEED_TEMPLATES) {
      inserted.run(
        tmpl.templateId,
        tmpl.name,
        tmpl.type,
        tmpl.category,
        tmpl.thumbnailUrl || '',
        tmpl.promptTemplate || '',
        tmpl.requiresImage ? 1 : 0,
        tmpl.sortOrder,
        tmpl.enabled ? 1 : 0
      );
    }

    logger.info('MediaTemplates 种子数据已播种', {
      count: SEED_TEMPLATES.length,
    });
  }

  /** 获取所有启用的模板（按 sort_order 排序） */
  list(): MediaTemplateRecord[] {
    // @ts-ignore
    const rows = this.db
      .query(
        'SELECT * FROM media_templates WHERE enabled = 1 ORDER BY sort_order ASC'
      )
      .all() as any[];

    return rows.map((row: any) => ({
      templateId: row.template_id,
      name: row.name,
      type: row.type,
      category: row.category || '',
      thumbnailUrl: row.thumbnail_url || undefined,
      promptTemplate: row.prompt_template || undefined,
      requiresImage: row.requires_image === 1,
      sortOrder: row.sort_order || 0,
      enabled: row.enabled === 1,
    }));
  }

  /** 获取单个模板 */
  get(templateId: string): MediaTemplateRecord | null {
    // @ts-ignore
    const row = this.db
      .query('SELECT * FROM media_templates WHERE template_id = ?')
      .get(templateId) as any;

    if (!row) return null;

    return {
      templateId: row.template_id,
      name: row.name,
      type: row.type,
      category: row.category || '',
      thumbnailUrl: row.thumbnail_url || undefined,
      promptTemplate: row.prompt_template || undefined,
      requiresImage: row.requires_image === 1,
      sortOrder: row.sort_order || 0,
      enabled: row.enabled === 1,
    };
  }

  close(): void {
    this.db.close();
  }
}

/** 全局单例 */
let _instance: MediaTemplates | null = null;

export function getMediaTemplates(): MediaTemplates {
  if (!_instance) {
    _instance = new MediaTemplates();
  }
  return _instance;
}
