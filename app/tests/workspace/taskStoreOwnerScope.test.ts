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
 * 租户级 DB 期 3：`TaskStore` 的**行级隔离**（基础设施专项 §6.1）。
 *
 * 单表 `tasks`：9 条读写 SQL 全部带 owner 过滤；主键改 `(id, owner_key)`
 * （纵深防御：`INSERT OR REPLACE` 不得静默覆盖他人同 id 行）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { TaskStore } from '../../src/workspace/TaskStore';
import type { TaskNode } from '../../src/workspace/types';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const store = TaskStore.getInstance(':memory:');

beforeAll(async () => {
  await store.initialize();
});

afterAll(() => {
  store.close();
});

const node = (over: Partial<TaskNode> & { id: string }): TaskNode => ({
  workspaceId: 'ws-1',
  projectId: 'p-1',
  title: 't',
  description: '',
  type: 'task',
  status: 'planning',
  priority: 3,
  tags: [],
  dependsOn: [],
  progress: 0,
  createdAt: '2026-10-24T00:00:00.000Z',
  updatedAt: '2026-10-24T00:00:00.000Z',
  ...over,
});

describe('TaskStore：行级隔离', () => {
  it('列表 / 单查只看得见自己的任务', async () => {
    await runWithPrincipal(ALICE, () =>
      store.save(
        node({
          id: 'a-1',
          workspaceId: 'iso1-ws',
          projectId: 'iso1-p',
          title: 'alice-task',
        })
      )
    );
    await runWithPrincipal(BOB, () =>
      store.save(
        node({
          id: 'b-1',
          workspaceId: 'iso1-ws',
          projectId: 'iso1-p',
          title: 'bob-task',
        })
      )
    );

    expect(
      (
        await runWithPrincipal(ALICE, () => store.listByWorkspace('iso1-ws'))
      ).map((t) => t.id)
    ).toEqual(['a-1']);
    expect(
      (await runWithPrincipal(BOB, () => store.listByProject('iso1-p'))).map(
        (t) => t.id
      )
    ).toEqual(['b-1']);

    expect(await runWithPrincipal(BOB, () => store.get('a-1'))).toBeNull();
  });

  it('同 id 在两用户下各存一行（复合主键，互不覆盖）', async () => {
    await runWithPrincipal(ALICE, () =>
      store.save(
        node({
          id: 'shared',
          workspaceId: 'iso2-ws',
          projectId: 'iso2-p',
          title: 'alice-copy',
        })
      )
    );
    await runWithPrincipal(BOB, () =>
      store.save(
        node({
          id: 'shared',
          workspaceId: 'iso2-ws',
          projectId: 'iso2-p',
          title: 'bob-copy',
        })
      )
    );

    expect(
      (await runWithPrincipal(ALICE, () => store.get('shared')))?.title
    ).toBe('alice-copy');
    expect(
      (await runWithPrincipal(BOB, () => store.get('shared')))?.title
    ).toBe('bob-copy');
  });

  it('更新 / 删除不波及他人', async () => {
    // 自播种：本用例自己建 ALICE 的目标行，不依赖其他用例先跑
    await runWithPrincipal(ALICE, () =>
      store.save(
        node({
          id: 'a-1',
          workspaceId: 'iso3-ws',
          projectId: 'iso3-p',
          title: 'alice-task',
        })
      )
    );

    const bobUpdate = await runWithPrincipal(BOB, () =>
      store.update('a-1', { title: 'hijacked' })
    );
    expect(bobUpdate).toBeNull();
    expect((await runWithPrincipal(ALICE, () => store.get('a-1')))?.title).toBe(
      'alice-task'
    );

    await runWithPrincipal(BOB, () => store.delete('a-1'));
    expect((await runWithPrincipal(ALICE, () => store.get('a-1')))?.id).toBe(
      'a-1'
    );
  });

  it('按状态 / 根任务 / 子任务查询也按 owner 收口', async () => {
    // 每例独立 workspace/project + 自播种（避免执行顺序影响精确列表断言）
    await runWithPrincipal(ALICE, () =>
      store.save(
        node({
          id: 'a-child',
          workspaceId: 'iso4-ws',
          projectId: 'iso4-p',
          status: 'active',
          parentId: 'iso4-parent',
        })
      )
    );
    await runWithPrincipal(BOB, () =>
      store.save(
        node({
          id: 'b-child',
          workspaceId: 'iso4-ws',
          projectId: 'iso4-p',
          status: 'active',
          parentId: 'iso4-parent',
        })
      )
    );
    await runWithPrincipal(BOB, () =>
      store.save(
        node({ id: 'b-1', workspaceId: 'iso4-ws', projectId: 'iso4-p' })
      )
    );
    await runWithPrincipal(BOB, () =>
      store.save(
        node({ id: 'shared', workspaceId: 'iso4-ws', projectId: 'iso4-p' })
      )
    );

    expect(
      (
        await runWithPrincipal(ALICE, () =>
          store.listByStatus('iso4-ws', 'active')
        )
      ).map((t) => t.id)
    ).toEqual(['a-child']);
    expect(
      (
        await runWithPrincipal(BOB, () =>
          store.listByStatus('iso4-ws', 'active')
        )
      ).map((t) => t.id)
    ).toEqual(['b-child']);

    // 根任务：BOB 看不到 ALICE 的 a-1（自己那两行 b-1 / shared 都在）
    expect(
      (await runWithPrincipal(BOB, () => store.listRootTasks('iso4-p')))
        .map((t) => t.id)
        .sort()
    ).toEqual(['b-1', 'shared']);

    // 子任务：BOB 用自己的 parentId 也拿不到 ALICE 的 a-child
    expect(
      (
        await runWithPrincipal(BOB, () => store.listChildren('iso4-parent'))
      ).map((t) => t.id)
    ).toEqual(['b-child']);
  });
});

describe('门禁：TaskStore 的读写 SQL 不许漏 owner_key', () => {
  it('所有 SELECT/INSERT/UPDATE/DELETE 模板都必须带 owner_key', () => {
    const src = readFileSync(
      new URL('../../src/workspace/TaskStore.ts', import.meta.url),
      'utf8'
    );
    const templates = [
      ...src.matchAll(/`[^`]*\$\{TASKS_TABLE_NAME\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(sql)
    );

    // 现状 9 条；少于它说明扫描本身失效
    expect(rowSql.length).toBeGreaterThanOrEqual(9);
    for (const sql of rowSql) expect(sql).toContain('owner_key');

    expect(src).toContain('PRIMARY KEY (id, owner_key)');
  });
});
