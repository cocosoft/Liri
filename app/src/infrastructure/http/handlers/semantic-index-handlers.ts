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
// IMPLIED, BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import type http from 'http';
import { sendError, readRequestBody } from './handler-utils';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('http:semanticIndex');

// ========== SemanticIndex Handlers ==========

/**
 * 构建语义索引
 */
export async function handleBuildSemanticIndex(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { rootDir, incremental = true } = JSON.parse(body);
    const { IndexBuilder } =
      await import('@modules/knowledge/semantic/builder');
    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const builder = new IndexBuilder();
    // KB-SEM（2026-08-27）：rootDir 默认改为知识库目录——原 `rootDir || resolvePyappHome()`
    // 在用户点"构建索引"（传空）时扫整个 ~/.pyapp 数据目录，索引与知识库完全脱节
    const effectiveRoot =
      rootDir || getDefaultKnowledgeBaseRegistry().getKnowledgeRoot();
    const result = await builder.build({
      rootDir: effectiveRoot,
      incremental,
      embedProvider: 'local',
      onProgress: (phase, done, total) => {
        // 进度日志节流：embedding 阶段每 100 条或最后一条才记录，避免高频刷屏
        if (phase === 'embedding' && done < total && done % 100 !== 0) return;
        logger.info(`Semantic index building: ${phase} ${done}/${total}`);
      },
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 语义搜索 GET /v1/semantic/search?q=...&topK=10
 */
export async function handleSearchSemantic(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const query = urlObj.searchParams.get('q');
    const topK = parseInt(urlObj.searchParams.get('topK') || '10', 10);
    const minScore = parseFloat(urlObj.searchParams.get('minScore') || '0.3');

    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'q parameter is required' } })
      );
      return;
    }

    const { SemanticStore } = await import('@modules/knowledge/semantic/store');
    const { globalEmbeddingManager } =
      await import('@modules/ai/embedding/EmbeddingManager');
    const { resolveDataSubDir } = await import('@modules/core/paths');
    const indexDir = resolveDataSubDir('semantic-index');
    // KB-SEM（2026-08-27）：provider/model 与构建/增量更新统一为 local/nomic-embed-text，
    // 原实现硬编码 ollama/all-minilm 造成三处配置漂移
    const store = new SemanticStore(indexDir, {
      provider: 'local',
      model: 'nomic-embed-text',
    });
    await store.load();

    await globalEmbeddingManager.initialize();
    const embedding = await globalEmbeddingManager.embedOne(query);
    if (embedding.length === 0) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Embedding failed' } }));
      return;
    }
    const hits = store.search(new Float32Array(embedding), topK, minScore);
    // KB-SEM（2026-08-27）：维度不匹配时不再静默返回空——历史索引由其他模型构建
    // （如 all-minilm 384 维 vs nomic 768 维）时，明确报错引导重建索引
    if (
      hits.length === 0 &&
      store.size > 0 &&
      store.dimension !== embedding.length
    ) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message:
              '向量维度不匹配（索引可能由其他嵌入模型构建），请先重建语义索引',
          },
        })
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(hits));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 获取索引状态 GET /v1/semantic/index/status
 */
export async function handleGetSemanticIndexStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { SemanticStore, readIndexMeta } =
      await import('@modules/knowledge/semantic/store');
    const { resolveDataSubDir } = await import('@modules/core/paths');
    const { stat } = await import('fs/promises');
    const { join } = await import('path');
    const indexDir = resolveDataSubDir('semantic-index');
    // KB-SEM（2026-08-27）：provider/model 与构建/搜索统一，避免三处配置漂移
    const store = new SemanticStore(indexDir, {
      provider: 'local',
      model: 'nomic-embed-text',
    });
    await store.load();

    const meta = await readIndexMeta(indexDir);
    // KB-SEM（2026-08-27）：docCount 按 path 去重统计文档数（原 `store.size` 是片段数，
    // 导致"文档数"与"片段数"永远相等）；补 sizeBytes（索引文件实际占用）
    const docCount = new Set(store.all.map((e) => e.path)).size;
    let sizeBytes: number | undefined;
    try {
      const s1 = await stat(join(indexDir, 'index.jsonl'));
      const s2 = await stat(join(indexDir, 'index.meta.json'));
      sizeBytes = s1.size + s2.size;
    } catch {
      // 索引文件不存在时保持 undefined
    }
    const status = {
      exists: meta !== null,
      docCount,
      chunkCount: store.size,
      sizeBytes,
      provider: meta?.provider,
      model: meta?.model,
      lastIndexedAt: meta?.updatedAt
        ? new Date(meta.updatedAt).getTime()
        : undefined,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 清除语义索引 DELETE /v1/semantic/index
 */
export async function handleClearSemanticIndex(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { wipeStoreFiles } =
      await import('@modules/knowledge/semantic/store');
    const { resolveDataSubDir } = await import('@modules/core/paths');
    await wipeStoreFiles(resolveDataSubDir('semantic-index'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    sendError(res, err);
  }
}
