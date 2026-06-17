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

import type http from 'node:http';
import { sendError, readRequestBody } from './handler-utils';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

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
    const { IndexBuilder } = await import('@modules/knowledge/semantic/builder');
    const builder = new IndexBuilder();
    const result = await builder.build({
      rootDir,
      incremental,
      embedProvider: 'local',
      onProgress: (phase, done, total) => {
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
      res.end(JSON.stringify({ error: { message: 'q parameter is required' } }));
      return;
    }

    const { SemanticStore } = await import('@modules/knowledge/semantic/store');
    const { globalEmbeddingManager } = await import('@modules/ai/embedding/EmbeddingManager');
    const { resolveDataSubDir } = await import('@modules/core/paths');
    const store = new SemanticStore(
      resolveDataSubDir('semantic-index'),
      { provider: 'local', model: 'nomic-embed-text' }
    );
    await store.load();

    globalEmbeddingManager.initialize();
    const embedding = await globalEmbeddingManager.embedOne(query);
    if (embedding.length === 0) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Embedding failed' } }));
      return;
    }
    const hits = store.search(new Float32Array(embedding), topK, minScore);

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
    const { SemanticStore, readIndexMeta } = await import('@modules/knowledge/semantic/store');
    const { resolveDataSubDir } = await import('@modules/core/paths');
    const store = new SemanticStore(
      resolveDataSubDir('semantic-index'),
      { provider: 'ollama', model: 'all-minilm' }
    );
    await store.load();

    const meta = await readIndexMeta(resolveDataSubDir('semantic-index'));
    const status = {
      entryCount: store.size,
      indexExists: meta !== null,
      meta,
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
    const { wipeStoreFiles } = await import('@modules/knowledge/semantic/store');
    const { resolveDataSubDir } = await import('@modules/core/paths');
    await wipeStoreFiles(resolveDataSubDir('semantic-index'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    sendError(res, err);
  }
}
