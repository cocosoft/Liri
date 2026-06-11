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

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';

// ========== Kanban Handlers ==========

export async function handleKanbanList(
  ctx: HandlerCtx,
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      const cards = await store.loadKanbanCards();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cards));
    } catch (err) {
    }
  }

export async function handleKanbanCreate(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const { title, description, columnId, assignee, priority, tags } = JSON.parse(body);
      const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
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
    } catch (err) {
    }
  }

export async function handleKanbanUpdate(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cardId: string
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const { title, description, assignee, priority, tags } = JSON.parse(body);
      const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      await store.saveKanbanCard({ id: cardId, title: title || '', description, assignee, priority, tags });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
    }
  }

export async function handleKanbanDelete(
  ctx: HandlerCtx,
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    cardId: string
  ): Promise<void> {
    try {
      const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      await store.deleteKanbanCard(cardId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
    }
  }

export async function handleKanbanMove(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cardId: string
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const { columnId, sortOrder } = JSON.parse(body);
      const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      await store.updateKanbanCardColumn(cardId, columnId, sortOrder ?? Date.now());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
    }
  }
