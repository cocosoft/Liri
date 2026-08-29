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
import { randomUUID } from 'node:crypto';

const logger = getLogger('http:semanticIndex');

// ── 语义索引构建任务管理（KB-SEM-P13：异步构建 + 进度轮询） ────────────

interface BuildTask {
  id: string;
  status: 'running' | 'done' | 'error';
  phase: string;
  done: number;
  total: number;
  startedAt: number;
  finishedAt?: number;
  result?: {
    ok: boolean;
    chunkCount: number;
    embeddedCount: number;
    skippedCount: number;
    durationMs: number;
    indexDir: string;
    error?: string;
  };
  error?: string;
}

/** 进行中的构建任务（保留最近 MAX_TASKS 个供前端轮询最终结果） */
const buildTasks = new Map<string, BuildTask>();
const MAX_TASKS = 20;

function addBuildTask(task: BuildTask): void {
  buildTasks.set(task.id, task);
  // 超出上限时清理最早完成/失败的任务
  if (buildTasks.size > MAX_TASKS) {
    const oldest = [...buildTasks.values()].sort(
      (a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt)
    )[0];
    if (oldest) buildTasks.delete(oldest.id);
  }
}

/** 若已有 running 任务则返回其 taskId（幂等，避免重复构建） */
function findRunningTask(): string | null {
  for (const t of buildTasks.values()) {
    if (t.status === 'running') return t.id;
  }
  return null;
}

// ── 搜索共享单例（KB-SEM-P13：避免每次请求全量解析 JSONL） ─────────────

let sharedStore:
  | import('@modules/knowledge/semantic/store').SemanticStore
  | null = null;
let sharedStoreDir = '';
let sharedStoreStamp = '';

/**
 * 获取共享 SemanticStore。通过比对 index.meta.json 的 updatedAt 判断索引是否
 * 变化，变化才重新 load——保证复用缓存的同时索引更新后立即可见
 */
async function getSharedStore(
  indexDir: string
): Promise<import('@modules/knowledge/semantic/store').SemanticStore> {
  const { SemanticStore, readIndexMeta } =
    await import('@modules/knowledge/semantic/store');
  const meta = await readIndexMeta(indexDir);
  const stamp = meta?.updatedAt ?? '';
  if (
    sharedStore &&
    sharedStoreDir === indexDir &&
    sharedStoreStamp === stamp
  ) {
    return sharedStore;
  }
  const store = new SemanticStore(indexDir, {
    provider: 'local',
    model: 'nomic-embed-text',
  });
  await store.load();
  sharedStore = store;
  sharedStoreDir = indexDir;
  sharedStoreStamp = stamp;
  return store;
}

/** 索引被清空/重建时使缓存失效 */
function resetSharedStore(): void {
  sharedStore = null;
  sharedStoreDir = '';
  sharedStoreStamp = '';
}

// ========== SemanticIndex Handlers ==========

/**
 * 构建语义索引（异步任务）
 *
 * KB-SEM-P13（2026-08-27）：原实现同步阻塞——大目录构建数分钟，前端 HTTP 超时
 * 后误报"构建失败"但后端仍在构建。改为后台任务立即返回 taskId，前端轮询进度。
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

    // 幂等：已有进行中任务则直接返回其 taskId
    const runningId = findRunningTask();
    if (runningId) {
      logger.info('语义索引构建已有进行中任务，复用', { taskId: runningId });
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ taskId: runningId }));
      return;
    }

    const taskId = randomUUID();
    const task: BuildTask = {
      id: taskId,
      status: 'running',
      phase: 'chunking',
      done: 0,
      total: 1,
      startedAt: Date.now(),
    };
    addBuildTask(task);
    logger.info('语义索引构建任务启动', {
      taskId,
      rootDir: effectiveRoot,
      incremental,
    });

    void (async () => {
      try {
        const result = await builder.build({
          rootDir: effectiveRoot,
          incremental,
          embedProvider: 'local',
          onProgress: (phase, done, total) => {
            task.phase = phase;
            task.done = done;
            task.total = total;
            // 进度日志节流：embedding 阶段每 100 条或最后一条才记录，避免高频刷屏
            if (phase === 'embedding' && done < total && done % 100 !== 0)
              return;
            logger.info(`Semantic index building: ${phase} ${done}/${total}`);
          },
        });
        task.status = result.ok ? 'done' : 'error';
        task.result = result;
        task.error = result.ok ? undefined : result.error;
        if (result.ok) {
          logger.info('语义索引构建任务完成', {
            taskId,
            chunkCount: result.chunkCount,
            embeddedCount: result.embeddedCount,
            skippedCount: result.skippedCount,
            durationMs: result.durationMs,
          });
        } else {
          logger.error('语义索引构建任务失败（构建器返回错误）', {
            taskId,
            error: result.error,
          });
        }
      } catch (err) {
        task.status = 'error';
        task.error = err instanceof Error ? err.message : String(err);
        logger.error('语义索引构建任务异常', {
          taskId,
          error: task.error,
        });
      } finally {
        task.finishedAt = Date.now();
        // 构建完成/失败后，清空共享 store 缓存（索引已变化）
        resetSharedStore();
      }
    })();

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ taskId }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 查询构建任务进度 GET /v1/semantic/index/task?taskId=xxx
 */
export async function handleGetSemanticBuildTask(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const taskId = urlObj.searchParams.get('taskId');
    if (!taskId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'taskId parameter is required' } })
      );
      return;
    }
    const task = buildTasks.get(taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '任务不存在或已过期' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(task));
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

    const { globalEmbeddingManager } = await import('@modules/ai');
    const { resolveDataSubDir } = await import('@modules/core/paths');
    const indexDir = resolveDataSubDir('semantic-index');
    // KB-SEM-P13（2026-08-27）：复用共享单例——原实现每次请求 new SemanticStore
    // + load() 全量解析 JSONL，文档多时搜索慢
    const store = await getSharedStore(indexDir);

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
    // KB-SEM-P13：索引已清空，共享 store 缓存失效
    resetSharedStore();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    sendError(res, err);
  }
}
