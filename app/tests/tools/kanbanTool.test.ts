// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Q-18（2026-10-23）：`kanban` 由影子工具 `rewrite` 后接线的回归锁。
 *
 * 锁定四点：
 * ① **数据源唯一** —— 读写经 `getTaskOpsPort()`（SQLite `kanban_cards`），不再有进程内 Map；
 * ② 列 / 优先级 **fail-closed** 校验（非法值明确报错，不静默修正）；
 * ③ `update` 是**合并**（`saveKanbanCard` 整行 upsert ⇒ 未提供字段不能被清空）；
 * ④ 工具声明：本地写（风险 `write`）、参数面只保留卡片 CRUD。
 */
import { describe, expect, it } from 'bun:test';

import {
  CARD_PRIORITIES,
  KanbanTool,
  KANBAN_COLUMNS,
  normalizeColumn,
  normalizePriority,
  type KanbanCard,
  type KanbanPort,
} from '../../src/tools/KanbanTool/KanbanTool';
import { deriveToolRiskClass } from '../../src/tools/toolRiskClass';

/** 内存替身：模拟端口（仅测试用，生产走 SQLite） */
function makePort(initial: KanbanCard[] = []): {
  port: KanbanPort;
  cards: Map<string, KanbanCard>;
} {
  const cards = new Map(initial.map((c) => [c.id, { ...c }]));
  const port: KanbanPort = {
    listKanbanCards: async () => Array.from(cards.values()),
    saveKanbanCard: async (card) => {
      cards.set(card.id, {
        ...(cards.get(card.id) ?? ({} as KanbanCard)),
        ...card,
      } as KanbanCard);
    },
    deleteKanbanCard: async (id) => {
      cards.delete(id);
    },
    moveKanbanCard: async (id, columnId, sortOrder) => {
      const existing = cards.get(id);
      if (existing) cards.set(id, { ...existing, columnId, sortOrder });
    },
  };
  return { port, cards };
}

const CARD: KanbanCard = {
  id: 'kb_1',
  title: 'Ship Q-18',
  description: 'desc',
  columnId: 'todo',
  assignee: 'me',
  priority: 'medium',
  tags: ['a'],
  sortOrder: 1,
  createdAt: 1,
  updatedAt: 1,
};

describe('kanban：列 / 优先级校验（fail-closed）', () => {
  it('列白名单与客户端一致；缺省 todo；非法 ⇒ 报错', () => {
    expect([...KANBAN_COLUMNS]).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'done',
    ]);
    expect(normalizeColumn(undefined)).toEqual({ ok: true, columnId: 'todo' });
    expect(normalizeColumn('done')).toEqual({ ok: true, columnId: 'done' });

    const bad = normalizeColumn('archived');
    expect(bad.ok).toBe(false);
  });

  it('优先级三档；缺省 medium；非法 ⇒ 报错', () => {
    expect([...CARD_PRIORITIES]).toEqual(['low', 'medium', 'high']);
    expect(normalizePriority(undefined)).toEqual({
      ok: true,
      priority: 'medium',
    });
    expect(normalizePriority('unknown').ok).toBe(false);
  });
});

describe('kanban：卡片 CRUD 走端口（无内存 Map）', () => {
  it('create：写入端口，列/优先级取默认值', async () => {
    const { port, cards } = makePort();
    const tool = new KanbanTool(port);

    const result = await tool.execute(
      { action: 'create', title: 'New card' },
      {} as never
    );

    expect(result.success).toBe(true);
    const created = Array.from(cards.values());
    expect(created).toHaveLength(1);
    expect(created[0]?.title).toBe('New card');
    expect(created[0]?.columnId).toBe('todo');
    expect(created[0]?.priority).toBe('medium');
  });

  it('list：可选 columnId 过滤', async () => {
    const { port } = makePort([
      CARD,
      { ...CARD, id: 'kb_2', columnId: 'done' },
    ]);
    const tool = new KanbanTool(port);

    const all = await tool.execute({ action: 'list' }, {} as never);
    expect((all.data as { total: number }).total).toBe(2);

    const done = await tool.execute(
      { action: 'list', columnId: 'done' },
      {} as never
    );
    expect(
      (done.data as { cards: KanbanCard[] }).cards.map((c) => c.id)
    ).toEqual(['kb_2']);
  });

  it('update：合并旧值（未提供字段不被清空）', async () => {
    const { port, cards } = makePort([CARD]);
    const tool = new KanbanTool(port);

    const result = await tool.execute(
      { action: 'update', cardId: 'kb_1', title: 'Renamed' },
      {} as never
    );

    expect(result.success).toBe(true);
    const updated = cards.get('kb_1');
    expect(updated?.title).toBe('Renamed');
    expect(updated?.description).toBe('desc');
    expect(updated?.assignee).toBe('me');
    expect(updated?.tags).toEqual(['a']);
  });

  it('move / delete：走端口并保留错误语义（卡不存在 ⇒ 失败）', async () => {
    const { port, cards } = makePort([CARD]);
    const tool = new KanbanTool(port);

    const moved = await tool.execute(
      { action: 'move', cardId: 'kb_1', columnId: 'in_progress' },
      {} as never
    );
    expect(moved.success).toBe(true);
    expect(cards.get('kb_1')?.columnId).toBe('in_progress');

    const deleted = await tool.execute(
      { action: 'delete', cardId: 'kb_1' },
      {} as never
    );
    expect(deleted.success).toBe(true);
    expect(cards.size).toBe(0);

    const missing = await tool.execute(
      { action: 'delete', cardId: 'kb_1' },
      {} as never
    );
    expect(missing.success).toBe(false);
  });

  it('非法列 / 缺 title ⇒ 失败且不落库', async () => {
    const { port, cards } = makePort();
    const tool = new KanbanTool(port);

    const badColumn = await tool.execute(
      { action: 'create', title: 'x', columnId: 'nope' },
      {} as never
    );
    expect(badColumn.success).toBe(false);

    const noTitle = await tool.execute({ action: 'create' }, {} as never);
    expect(noTitle.success).toBe(false);
    expect(cards.size).toBe(0);
  });
});

describe('kanban：工具声明', () => {
  it('本地写（风险 write）；动作面收敛为卡片 CRUD', () => {
    const tool = new KanbanTool(makePort().port);

    expect(deriveToolRiskClass(tool, {})).toBe('write');
    expect(tool.getInfo().riskClass).toBe('write');
    expect(tool.params.map((p) => p.name)).toEqual([
      'action',
      'cardId',
      'title',
      'description',
      'columnId',
      'priority',
      'assignee',
      'tags',
    ]);
    expect(tool.params[0]?.enum).toEqual([
      'list',
      'create',
      'update',
      'move',
      'delete',
    ]);
  });
});
