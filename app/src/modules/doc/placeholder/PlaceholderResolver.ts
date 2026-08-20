/**
 * 占位符解析器（设计方案 §4.3 v0.4 增强）
 *
 * 格式：![图片描述](GENERATE:id=img-1;prompt=提示词)
 *
 * 特性：
 *  - id 字段：同 id 图片只生成一次，多节点引用同一张图时复用
 *  - prompt 字段：分号 ; 分隔字段，解析以 GENERATE: 起始、以换行/下一个占位符结束
 *  - 避免提示词内含 ) 导致截断（v0.4 修正原方案缺陷）
 */

import { getLogger } from '@modules/monitoring';
import type { ImagePlaceholder } from '../types/outline';

const logger = getLogger('doc:placeholderResolver');

// ─── 正则：匹配 ![描述](GENERATE:id=xxx;prompt=xxx) ─────────

/**
 * 匹配规则：
 *  - `![` 起始
 *  - `]` 后紧跟 `(GENERATE:`
 *  - 字段以 `;` 分隔，格式 `key=value`
 *  - 必须包含 `id` 和 `prompt` 字段
 *  - 以换行或字符串末尾结束（不依赖 `)` 作为终止符，避免提示词含 `)` 截断）
 */
const PLACEHOLDER_RE = /!\[([^\]]*)\]\(GENERATE:([^\n)]+)/g;

// ─── 解析 ──────────────────────────────────────────────

/**
 * 从文本中解析所有图片占位符
 *
 * @returns 占位符列表（按出现顺序）
 */
export function parsePlaceholders(text: string): ImagePlaceholder[] {
  const results: ImagePlaceholder[] = [];
  let match: RegExpExecArray | null;

  // 重置 regex lastIndex（全局 regex 复用安全）
  PLACEHOLDER_RE.lastIndex = 0;

  while ((match = PLACEHOLDER_RE.exec(text)) !== null) {
    const description = match[1] || '';
    const body = match[2] || '';
    const raw = match[0];

    // 解析 key=value 字段（以 ; 分隔）
    const fields = parseFields(body);
    const id = fields.get('id');
    const prompt = fields.get('prompt');

    if (!id || !prompt) {
      logger.warn('placeholderResolver:missing_fields', {
        raw: raw.slice(0, 100),
        hasId: !!id,
        hasPrompt: !!prompt,
      });
      continue;
    }

    results.push({
      raw,
      description,
      id,
      prompt,
    });
  }

  return results;
}

/**
 * 解析 GENERATE: 后的字段体（key=value;key=value 格式）
 */
function parseFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  const parts = body.split(';');

  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    if (key) {
      fields.set(key, value);
    }
  }

  return fields;
}

// ─── 替换 ──────────────────────────────────────────────

/**
 * 将文本中的占位符替换为实际图片路径
 *
 * @param text 含占位符的文本
 * @param imageCache id → filePath 映射
 * @returns 替换后的文本 + 未命中缓存的占位符列表（需生成）
 */
export function replacePlaceholders(
  text: string,
  imageCache: Map<string, string>
): {
  replaced: string;
  missed: ImagePlaceholder[];
} {
  const placeholders = parsePlaceholders(text);
  const missed: ImagePlaceholder[] = [];

  let replaced = text;
  for (const ph of placeholders) {
    const filePath = imageCache.get(ph.id);
    if (filePath) {
      // 替换为 Markdown 图片语法
      replaced = replaced.replace(ph.raw, `![${ph.description}](${filePath})`);
      logger.debug('placeholderResolver:replaced', {
        id: ph.id,
        filePath,
      });
    } else {
      missed.push(ph);
      logger.debug('placeholderResolver:missed', {
        id: ph.id,
        prompt: ph.prompt.slice(0, 50),
      });
    }
  }

  return { replaced, missed };
}

// ─── 去重 ──────────────────────────────────────────────

/**
 * 按占位符 id 去重，返回需要生成图片的唯一占位符列表
 * 同 id 的多个占位符只保留首个（其余复用）
 */
export function deduplicatePlaceholders(
  placeholders: ImagePlaceholder[]
): ImagePlaceholder[] {
  const seen = new Set<string>();
  const unique: ImagePlaceholder[] = [];

  for (const ph of placeholders) {
    if (!seen.has(ph.id)) {
      seen.add(ph.id);
      unique.push(ph);
    }
  }

  return unique;
}

// ─── 占位符生成 ────────────────────────────────────────

/**
 * 为大纲节点生成占位符文本
 * 阶段①大纲生成时，imageHint 非空的节点自动分配占位符 id
 */
export function buildPlaceholderText(
  description: string,
  id: string,
  prompt: string
): string {
  return `![${description}](GENERATE:id=${id};prompt=${prompt})`;
}

/**
 * 生成唯一占位符 ID
 */
let placeholderCounter = 0;
export function generatePlaceholderId(): string {
  placeholderCounter++;
  return `img-${Date.now()}-${placeholderCounter}`;
}
