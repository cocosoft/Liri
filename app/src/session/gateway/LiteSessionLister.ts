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
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 轻量会话列表扫描（`SessionGateway.listLiteSessions` 的实现）
 *
 * 由 `session/SessionGateway.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §32 批 C2）。
 *
 * ⚠️ **只搬不改**：扫描逻辑逐字保留；logger module 名保持 `session:gateway`
 * （与宿主一致）⇒ 日志输出不变。
 */

import { getLogger } from '@modules/monitoring';
import { resolveSessionsDir } from '@modules/core';

const logger = getLogger('session:gateway');

/** 轻量会话摘要（`listLiteSessions` 的产出项） */
export interface LiteSessionSummary {
  id: string;
  title?: string;
  status?: string;
  updatedAt?: string;
}

/**
 * 扫描所需的最小端口 —— `UnifiedSessionStorage.getStorageInfo(): StorageConfig`
 * 的**结构子集**（本簇只读 `basePath`）。
 */
export interface LiteSessionListSource {
  getStorageInfo(): { basePath?: string } | null | undefined;
}

/**
 * 轻量列出会话元数据 — 只扫描文件头 64KB，不加载完整 JSON
 * 比 listSessions 快 5-10x，适合侧边栏列表渲染
 */
export async function listLiteSessions(
  storage: LiteSessionListSource
): Promise<LiteSessionSummary[]> {
  const { readdirSync, statSync, existsSync } = require('fs');
  const { join } = require('path');
  const { readLiteSessionMeta } =
    await import('../storage/LiteSessionReader.js');
  // M1 修复：统一从 storage.getStorageInfo().basePath 取会话目录根，
  // 不再硬编码 resolveSessionsDir()（忽略 storageConfig.basePath 配置）。
  // StorageAdapter/Memory 存储无 basePath 时回退默认值。
  // P2-3：basePath 空串不生效（?? 不拦截空串），统一回退默认目录。
  const storageInfo = storage.getStorageInfo();
  const sessionsDir =
    storageInfo?.basePath && storageInfo.basePath.trim()
      ? storageInfo.basePath
      : resolveSessionsDir();
  // P2-1：目录状态结构化——目录缺失（missing）≠ 无会话，区分记录便于排查
  // "历史记录不显示"类问题（目录在但无数据 vs 目录压根不存在）
  if (!existsSync(sessionsDir)) {
    logger.warn('listLiteSessions:会话目录不存在（missing），返回空列表', {
      sessionsDir,
    });
    return [];
  }
  logger.info('listLiteSessions:开始扫描会话目录', { sessionsDir });

  let entries: string[];
  try {
    entries = readdirSync(sessionsDir);
  } catch (err) {
    logger.warn('listLiteSessions:会话目录读取失败，返回空列表', {
      sessionsDir,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  logger.info('listLiteSessions:目录条目总数', {
    sessionsDir,
    entryCount: entries.length,
    status: entries.length === 0 ? 'empty' : 'ok',
  });

  let skippedHidden = 0;
  let statFailed = 0;
  let dirCount = 0;
  let fileCount = 0;
  let metaNull = 0;

  // R1-4 修复：用 Map 按 id 去重（目录布局为当前布局，优先；旧布局文件兜底），
  // 避免迁移中间态（{id}/session.json 与 {id}.json 并存）产出重复 id。
  const resultMap = new Map<
    string,
    {
      title?: string;
      status?: string;
      updatedAt?: string;
      temporary?: string | null;
    }
  >();

  for (const entry of entries) {
    if (entry.startsWith('.')) {
      skippedHidden++;
      continue; // 跳过隐藏文件/迁移标记
    }
    const fullPath = join(sessionsDir, entry);
    let isDir = false;
    try {
      isDir = statSync(fullPath).isDirectory();
    } catch (err) {
      statFailed++;
      logger.debug('listLiteSessions:条目 stat 失败，跳过', {
        entry,
        fullPath,
        error: err instanceof Error ? err.message : String(err),
      });
      continue; // 条目已消失（并发删除），跳过
    }

    if (isDir) {
      // 当前存储布局：每会话一个子目录 {sessionId}/session.json
      dirCount++;
      const sessionId = entry;
      const meta = readLiteSessionMeta(join(fullPath, 'session.json'));
      if (meta) {
        logger.debug('listLiteSessions:子目录命中会话元数据', {
          sessionId,
          fullPath,
          meta,
        });
        resultMap.set(sessionId, meta);
      } else {
        metaNull++;
        logger.debug('listLiteSessions:子目录未解析出元数据，跳过', {
          sessionId,
          fullPath,
        });
      }
    } else {
      // 兼容旧布局：直接 JSON 文件 {sessionId}.json
      fileCount++;
      const sessionId = entry.replace(/\.json$/i, '');
      const meta = readLiteSessionMeta(fullPath);
      if (meta) {
        logger.debug('listLiteSessions:直接文件命中会话元数据', {
          sessionId,
          fullPath,
          meta,
        });
        // 目录布局已命中时保留目录版本，旧文件仅作兜底
        if (!resultMap.has(sessionId)) {
          resultMap.set(sessionId, meta);
        }
      } else {
        metaNull++;
        logger.debug('listLiteSessions:直接文件未解析出元数据，跳过', {
          sessionId,
          fullPath,
        });
      }
    }
  }

  const results = [...resultMap.entries()]
    .filter(([, meta]) => meta.temporary !== 'true')
    .map(([id, meta]) => ({
      id,
      ...meta,
    }));

  logger.info('listLiteSessions:扫描完成', {
    sessionsDir,
    entryCount: entries.length,
    resultCount: results.length,
    skippedHidden,
    statFailed,
    dirCount,
    fileCount,
    metaNull,
  });
  return results;
}
