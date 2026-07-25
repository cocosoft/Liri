// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * RerankService — 检索结果重排序服务
 *
 * 通过 ModelRouter.resolve('reranking') 获取用户配置的重排序模型，
 * 调用 Provider 的 rerank API 对检索结果进行二次精排。
 *
 * 使用方式：
 *   1. 用户在「模型管理 → 任务分工」配置 reranking 任务对应的模型
 *   2. RerankService 通过 modelRouter 自动获取配置
 *   3. KnowledgeRouter.search() 融合后自动调用 rerank()
 *
 * 降级策略：
 *   - 用户未配置 reranking 模型 → 跳过重排序（INFO 日志）
 *   - Provider 不支持 rerank → 跳过重排序（WARNING 日志）
 *   - API 调用失败 → 跳过重排序（ERROR 日志）
 *
 * 禁止硬编码模型名。
 */

import { modelRouter } from '@modules/ai';
import { providerRegistry } from '@modules/ai/providers/ProviderRegistry';
import type {
  RerankRequest,
  RerankResult,
} from '@modules/ai/providers/AIProvider';
import { LogLevel } from '@modules/monitoring';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing';

const logger = new OTelAwareLogger({
  module: 'knowledge:rerank',
  level: LogLevel.INFO,
});

/** 重排序输入文档 */
export interface RerankDocument {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * 对检索结果进行重排序
 *
 * @param query 原始查询
 * @param docs 检索结果文档列表
 * @param topN 返回条数，默认取全部
 * @returns 按 relevanceScore 降序排列的文档
 */
export async function rerankDocs(
  query: string,
  docs: RerankDocument[],
  topN?: number
): Promise<RerankDocument[]> {
  if (docs.length === 0) return [];

  const otel = getOTelTracing();
  const span = otel.startSpan('knowledge.rerank', {
    'knowledge.rerank.doc_count': docs.length,
  });

  try {
    // 1. 通过 ModelRouter 获取用户配置的 reranking 模型
    const modelKey = modelRouter.resolve('reranking');
    if (!modelKey) {
      logger.info('重排序跳过：未配置 reranking 任务模型');
      span.setAttribute('knowledge.rerank.skipped', 'not_configured');
      return docs;
    }

    // 2. 通过 ProviderRegistry 获取 Provider
    const provider = providerRegistry.getByModel(modelKey);
    // 类型守卫：检查 rerank 方法是否存在
    if (!provider || typeof (provider as any).rerank !== 'function') {
      logger.warn('重排序跳过：Provider 不支持 rerank', {
        model: modelKey,
      });
      span.setAttribute('knowledge.rerank.skipped', 'unsupported');
      return docs;
    }

    // 3. 调用 rerank API
    const contents = docs.map((d) => d.content);
    const request: RerankRequest = {
      query,
      documents: contents,
      topN: topN ?? Math.min(docs.length, 10),
      returnDocuments: false,
    };

    logger.info('调用重排序', {
      model: modelKey,
      docCount: contents.length,
    });

    const result: RerankResult = await (provider as any).rerank(request);

    span.setAttribute('knowledge.rerank.result_count', result.results.length);

    // 4. 按 relevanceScore 重新排序
    return result.results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .map((r) => ({
        ...docs[r.index],
        score: r.relevanceScore,
      }));
  } catch (err) {
    logger.error('重排序失败，降级返回原始结果', {
      error: (err as Error).message,
    });
    otel.recordError(span, err as Error);
    return docs;
  } finally {
    otel.endSpan(span);
  }
}

/** 兼容类形式的导出（用于构造函数注入场景） */
export class RerankService {
  async rerank(
    query: string,
    docs: RerankDocument[],
    topN?: number
  ): Promise<RerankDocument[]> {
    return rerankDocs(query, docs, topN);
  }
}
