// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * datasource-handlers.ts — 外部数据源 HTTP 处理器
 *
 * 端点：
 *   GET    /v1/knowledge/datasources → 列出已注册的数据源
 *   POST   /v1/knowledge/datasources → 创建数据源配置
 *   DELETE /v1/knowledge/datasources/:type → 删除数据源
 *   POST   /v1/knowledge/datasources/:type/sync → 手动触发同步
 */

import type http from 'http';
import { sendError, readRequestBody } from './handler-utils';
import { handleError } from '@modules/error';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { resolveDataSubDir } from '@modules/core';
import { existsSync } from 'fs';

const DS_CONFIG_PATH = join(
  resolveDataSubDir(''),
  'knowledge-datasources.json'
);

interface DataSourceEntry {
  type: string;
  url: string;
  enabled: boolean;
  intervalMs: number;
  maxItems?: number;
  knowledgeBase?: string;
  createdAt: number;
}

async function loadConfigs(): Promise<DataSourceEntry[]> {
  try {
    if (!existsSync(DS_CONFIG_PATH)) return [];
    const raw = await readFile(DS_CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveConfigs(configs: DataSourceEntry[]): Promise<void> {
  const dir = join(DS_CONFIG_PATH, '..');
  await mkdir(dir, { recursive: true });
  await writeFile(DS_CONFIG_PATH, JSON.stringify(configs, null, 2), 'utf-8');
}

/** GET /v1/knowledge/datasources */
export async function handleListDataSources(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const configs = await loadConfigs();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(configs));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:datasource',
      action: 'list',
    });
    sendError(res, (err as Error).message, 500);
  }
}

/** POST /v1/knowledge/datasources */
export async function handleCreateDataSource(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const entry: DataSourceEntry = JSON.parse(body);

    if (!entry.type || !entry.url) {
      sendError(res, '缺少必填字段: type, url', 400);
      return;
    }

    const configs = await loadConfigs();
    const idx = configs.findIndex((c) => c.type === entry.type);
    if (idx >= 0) {
      configs[idx] = {
        ...configs[idx],
        ...entry,
        createdAt: configs[idx]!.createdAt,
      };
    } else {
      configs.push({ ...entry, createdAt: Date.now() });
    }

    await saveConfigs(configs);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(entry));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:datasource',
      action: 'create',
    });
    sendError(res, (err as Error).message, 500);
  }
}

/** DELETE /v1/knowledge/datasources/:type */
export async function handleDeleteDataSource(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
    const segs = url.pathname.split('/');
    const dsType = segs[segs.length - 1];

    if (!dsType) {
      sendError(res, '缺少数据源类型', 400);
      return;
    }

    const configs = await loadConfigs();
    const filtered = configs.filter((c) => c.type !== dsType);
    await saveConfigs(filtered);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ deleted: true }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:datasource',
      action: 'delete',
    });
    sendError(res, (err as Error).message, 500);
  }
}

/** POST /v1/knowledge/datasources/:type/sync */
export async function handleSyncDataSource(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
    const segs = url.pathname.split('/');
    const dsType = segs[segs.length - 2];

    if (!dsType) {
      sendError(res, '缺少数据源类型', 400);
      return;
    }

    const configs = await loadConfigs();
    const config = configs.find((c) => c.type === dsType);
    if (!config) {
      sendError(res, `未找到数据源: ${dsType}`, 404);
      return;
    }

    // 根据类型创建对应连接器并同步
    let result;
    if (dsType === 'rss') {
      const { RSSConnector } =
        await import('@modules/knowledge/datasource/RSSConnector');
      const connector = new RSSConnector({
        type: 'rss',
        enabled: true,
        intervalMs: config.intervalMs || 3600000,
        url: config.url,
        maxItems: config.maxItems ?? 20,
      });
      result = await connector.sync();
    } else {
      sendError(res, `不支持的数据源类型: ${dsType}`, 400);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:datasource',
      action: 'sync',
    });
    sendError(res, (err as Error).message, 500);
  }
}
