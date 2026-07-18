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

import type http from 'http';
import { sendError, readRequestBody, broadcastEvent } from './handler-utils';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'infrastructure:http:handlers:kanban-handlers', level: LogLevel.INFO });

// ========== Kanban Handlers ==========

/**
 * 获取看板卡片列表
 */
export async function handleKanbanList(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { SqliteTaskStore } =
      await import('@modules/tasks/db/SqliteTaskStore');
    const store = new SqliteTaskStore();
    await store.init();
    const cards = await store.loadKanbanCards();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cards));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 创建看板卡片
 */
export async function handleKanbanCreate(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { title, description, columnId, assignee, priority, tags } =
      JSON.parse(body);
    const { SqliteTaskStore } =
      await import('@modules/tasks/db/SqliteTaskStore');
    const store = new SqliteTaskStore();
    await store.init();
    const card = {
      id: `kb_${Date.now().toString(36)}`,
      title,
      description,
      columnId: columnId || 'todo',
      assignee,
      priority: priority || 'medium',
      tags: tags || [],
      sortOrder: Date.now(),
    };
    await store.saveKanbanCard(card);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(card));
    broadcastEvent('kanban:created', { card });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 更新看板卡片
 */
export async function handleKanbanUpdate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cardId: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { title, description, assignee, priority, tags } = JSON.parse(body);
    const { SqliteTaskStore } =
      await import('@modules/tasks/db/SqliteTaskStore');
    const store = new SqliteTaskStore();
    await store.init();
    await store.saveKanbanCard({
      id: cardId,
      title: title || '',
      description,
      assignee,
      priority,
      tags,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    broadcastEvent('kanban:updated', { cardId });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 删除看板卡片
 */
export async function handleKanbanDelete(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  cardId: string
): Promise<void> {
  try {
    const { SqliteTaskStore } =
      await import('@modules/tasks/db/SqliteTaskStore');
    const store = new SqliteTaskStore();
    await store.init();
    await store.deleteKanbanCard(cardId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    broadcastEvent('kanban:deleted', { cardId });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 移动看板卡片到新列
 */
export async function handleKanbanMove(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cardId: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { columnId, sortOrder } = JSON.parse(body);
    const { SqliteTaskStore } =
      await import('@modules/tasks/db/SqliteTaskStore');
    const store = new SqliteTaskStore();
    await store.init();
    await store.updateKanbanCardColumn(
      cardId,
      columnId,
      sortOrder ?? Date.now()
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    broadcastEvent('kanban:moved', { cardId, columnId });
  } catch (err) {
    sendError(res, err);
  }
}
