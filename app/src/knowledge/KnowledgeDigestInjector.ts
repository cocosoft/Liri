// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * KnowledgeDigestInjector — 知识摘要注入器
 *
 * 从预编译的 digest.json 中提取 Top-K 摘要，注入到对话 system prompt 中。
 *
 * 选择策略（可配置）：
 *   - freshness: 按 lastModified 倒序
 *   - importance: 按 wordCount 倒序
 *   - combined:  freshnessScore * 0.6 + importanceScore * 0.4（默认）
 */

import { getDefaultDigestService } from '@modules/knowledge/KnowledgeDigestService';
import type { DocDigest } from '@modules/knowledge/KnowledgeDigestService';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'knowledge:digestInjector',
  level: LogLevel.INFO,
});

export type DigestSelectionStrategy = 'freshness' | 'importance' | 'combined';

export interface DigestInjectConfig {
  /** 注入条数，默认 3 */
  maxCount?: number;
  /** 选择策略，默认 'combined' */
  strategy?: DigestSelectionStrategy;
  /** 是否启用，默认 true */
  enabled?: boolean;
}

/**
 * 生成可注入到 system prompt 的知识摘要文本
 *
 * 格式：
 * ## 知识库参考
 * - [标题] 摘要概述...
 */
export async function generateDigestContext(
  config: DigestInjectConfig = {}
): Promise<string> {
  const { maxCount = 3, strategy = 'combined', enabled = true } = config;

  if (!enabled) return '';

  try {
    const digestService = getDefaultDigestService();
    const all = await digestService.getAllDigests();
    if (all.length === 0) return '';

    const sorted = selectTopDigests(all, strategy, maxCount);
    if (sorted.length === 0) return '';

    const lines = ['## 知识库参考'];
    for (const doc of sorted) {
      const snippet = doc.summary.length > 80
        ? doc.summary.slice(0, 80) + '...'
        : doc.summary;
      lines.push(`- [${doc.title}] ${snippet}`);
    }

    return lines.join('\n');
  } catch (err) {
    logger.debug('摘要注入失败，跳过', {
      error: err instanceof Error ? err.message : String(err),
    });
    return '';
  }
}

function selectTopDigests(
  docs: DocDigest[],
  strategy: DigestSelectionStrategy,
  count: number
): DocDigest[] {
  const now = Date.now();
  const maxWordCount = Math.max(...docs.map((d) => d.wordCount), 1);

  const scored = docs.map((doc) => {
    const lastMod = new Date(doc.lastModified).getTime();
    const ageDays = (now - lastMod) / (1000 * 60 * 60 * 24);
    const freshnessScore = 1 / (ageDays + 1);
    const importanceScore = doc.wordCount / maxWordCount;
    const combinedScore =
      strategy === 'freshness'
        ? freshnessScore
        : strategy === 'importance'
          ? importanceScore
          : freshnessScore * 0.6 + importanceScore * 0.4;

    return { doc, score: combinedScore };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map((s) => s.doc);
}
