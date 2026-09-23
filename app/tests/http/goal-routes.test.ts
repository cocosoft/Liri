/**
 * `/v1/goals` 路由契约测试（M-6 创建入口，2026-09-22）
 *
 * 覆盖：201 创建（字段往返）/ 400 三类校验（空 objective / 非法 tokenBudget / 非法 sessionId）
 * / 409 id 冲突不覆盖 / 200 列表（按会话、active 过滤、无参拒绝）/ 非本路由返回 false。
 *
 * **不写真实 `app.db`**：经 `setTaskGoalStoreForTest()` 注入临时库上的 store
 *（与 `resetAgentRunLedger()` 同法的测试缝）。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import type http from 'http';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { dispatchGoalRoutes } from '../../src/infrastructure/http/handlers/routes/goal-routes';
import {
  TaskGoalStore,
  setTaskGoalStoreForTest,
} from '../../src/tasks/goal/TaskGoalStore';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { dispatchRoute } from '../../src/infrastructure/http/handlers/route-table';

const createdPaths: string[] = [];
const opened: TaskGoalStore[] = [];

function installStore(): TaskGoalStore {
  const path = join(tmpdir(), `goal-routes-${randomUUID().slice(0, 8)}.db`);
  createdPaths.push(path);
  const store = new TaskGoalStore(path);
  opened.push(store);
  setTaskGoalStoreForTest(store);
  return store;
}

afterEach(() => {
  setTaskGoalStoreForTest(null);
  while (opened.length > 0) opened.pop()!.close();
  while (createdPaths.length > 0) {
    try {
      unlinkSync(createdPaths.pop()!);
    } catch {
      // @ignore-catch — 清理临时文件失败不影响断言
    }
  }
});

/**
 * 最小 req：只满足 `readBody` 的 `data`/`end` 契约。
 *
 * 注意：**在注册 `end` 监听时才派发**，不在创建时一次性派发。
 * 原因：经 `dispatchRoute`（route-table）路径时，请求要穿过十余个领域分发器
 * （每个都有 `await`）才轮到 `goal-routes`；若在创建时就派发，等本路由注册监听时
 * 事件早已错过 ⇒ `readBody` **永久挂起**（表现为用例超时）。
 * `readBody` 的实现是「先 `on('data')` 再 `on('end')`」（`handler-utils.ts:384`），
 * 故在 `end` 注册时派发可保证每次读取都拿到完整载荷。
 *
 * 另：必须带上 `url`（含查询串）—— 查询参数的**唯一真相源**是 `req.url`
 * （`LocalHTTPService` 传给 `dispatchRoute` 的 `url` 已去查询串，见 `LocalHTTPService.ts:380`）。
 */
function createReq(
  method: string,
  url: string,
  jsonBody?: unknown
): http.IncomingMessage {
  const payload = jsonBody === undefined ? '' : JSON.stringify(jsonBody);
  const handlers: Record<string, ((arg?: unknown) => void)[]> = {};
  const req = {
    method,
    url,
    on: (event: string, cb: (arg?: unknown) => void) => {
      (handlers[event] ??= []).push(cb);
      if (event === 'end') {
        queueMicrotask(() => {
          for (const handler of handlers['data'] ?? [])
            handler(Buffer.from(payload));
          for (const handler of handlers['end'] ?? []) handler();
        });
      }
    },
  } as unknown as http.IncomingMessage;
  return req;
}

function createRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
} {
  const out = { status: 0, body: '' };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    read: () => ({
      status: out.status,
      body: out.body ? (JSON.parse(out.body) as Record<string, unknown>) : {},
    }),
  };
}

const noopBroadcast = (): void => {};
const ctx = {} as HandlerCtx;

async function call(
  method: string,
  url: string,
  jsonBody?: unknown
): Promise<{
  status: number;
  body: Record<string, unknown>;
  matched: boolean;
}> {
  const { res, read } = createRes();
  const matched = await dispatchGoalRoutes(
    createReq(method, url, jsonBody),
    res,
    url,
    noopBroadcast,
    ctx
  );
  return { ...read(), matched };
}

describe('/v1/goals：创建（POST）', () => {
  test('201 创建成功，字段完整往返', async () => {
    installStore();
    const r = await call('POST', '/v1/goals', {
      objective: '把长程目标跑通',
      sessionId: 'sess-goal-1',
      tokenBudget: 5000,
    });

    expect(r.matched).toBe(true);
    expect(r.status).toBe(201);
    const goal = r.body['goal'] as Record<string, unknown>;
    expect(goal['objective']).toBe('把长程目标跑通');
    expect(goal['sessionId']).toBe('sess-goal-1');
    expect(goal['tokenBudget']).toBe(5000);
    expect(goal['status']).toBe('active');
    expect(goal['tokensUsed']).toBe(0);
  });

  test('400：objective 缺失/空白', async () => {
    installStore();
    expect((await call('POST', '/v1/goals', {})).status).toBe(400);
    expect((await call('POST', '/v1/goals', { objective: '   ' })).status).toBe(
      400
    );
  });

  test('400：tokenBudget 非正 / 非数', async () => {
    installStore();
    expect(
      (await call('POST', '/v1/goals', { objective: 'x', tokenBudget: 0 }))
        .status
    ).toBe(400);
    expect(
      (await call('POST', '/v1/goals', { objective: 'x', tokenBudget: -5 }))
        .status
    ).toBe(400);
    expect(
      (await call('POST', '/v1/goals', { objective: 'x', tokenBudget: '100' }))
        .status
    ).toBe(400);
  });

  test('400：sessionId 格式非法（路径穿越载荷）', async () => {
    installStore();
    const r = await call('POST', '/v1/goals', {
      objective: 'x',
      sessionId: '../etc/passwd',
    });
    expect(r.status).toBe(400);
  });

  test('400：请求体不是合法 JSON', async () => {
    installStore();
    const { res, read } = createRes();
    const badReq = {
      method: 'POST',
      on: (event: string, cb: (arg?: unknown) => void) => {
        queueMicrotask(() => {
          if (event === 'data') cb(Buffer.from('{not json'));
          if (event === 'end') cb();
        });
      },
    } as unknown as http.IncomingMessage;

    expect(
      await dispatchGoalRoutes(badReq, res, '/v1/goals', noopBroadcast, ctx)
    ).toBe(true);
    expect(read().status).toBe(400);
  });

  test('409：同 id 重复创建 ⇒ 拒绝且不覆盖既有目标', async () => {
    const store = installStore();
    const first = await call('POST', '/v1/goals', {
      objective: '第一次',
      id: 'goal-fixed',
    });
    expect(first.status).toBe(201);

    const second = await call('POST', '/v1/goals', {
      objective: '第二次',
      id: 'goal-fixed',
    });
    expect(second.status).toBe(409);
    // 既有目标未被覆盖
    expect((await store.get('goal-fixed'))?.objective).toBe('第一次');
  });
});

describe('/v1/goals：列表（GET）', () => {
  test('200：按会话列出；active=1 只回未终结', async () => {
    const store = installStore();
    const a = await store.create({ objective: 'A', sessionId: 'sess-l1' });
    const b = await store.create({ objective: 'B', sessionId: 'sess-l1' });
    await store.create({ objective: 'C', sessionId: 'sess-l2' });
    await store.updateStatus(b.id, 'completed');

    const all = await call('GET', '/v1/goals?sessionId=sess-l1');
    expect(all.status).toBe(200);
    expect((all.body['goals'] as unknown[]).length).toBe(2);

    const active = await call('GET', '/v1/goals?sessionId=sess-l1&active=1');
    expect(active.status).toBe(200);
    const ids = (active.body['goals'] as Array<{ id: string }>).map(
      (g) => g.id
    );
    expect(ids).toEqual([a.id]);
  });

  test('200：无 sessionId + active=1 ⇒ 全库未终结', async () => {
    const store = installStore();
    await store.create({ objective: 'A', sessionId: 'sess-g1' });
    const done = await store.create({ objective: 'B', sessionId: 'sess-g2' });
    await store.updateStatus(done.id, 'failed');

    const r = await call('GET', '/v1/goals?active=1');
    expect(r.status).toBe(200);
    expect((r.body['goals'] as unknown[]).length).toBe(1);
  });

  test('400：既无 sessionId 也无 active ⇒ 拒绝（避免无界全表扫描）', async () => {
    installStore();
    expect((await call('GET', '/v1/goals')).status).toBe(400);
  });

  test('非本路由 ⇒ 返回 false（不拦截其他 URL）', async () => {
    const { res } = createRes();
    expect(
      await dispatchGoalRoutes(
        createReq('GET', '/v1/other'),
        res,
        '/v1/other',
        noopBroadcast,
        ctx
      )
    ).toBe(false);
  });
});

/**
 * 注册线验证（防"实现了但没挂到路由表"）：
 * 上面的用例直接调 `dispatchGoalRoutes`，**绕过了 `route-table.ts`** ⇒
 * 若有人删掉注册行，全部用例仍会通过。此处经**真实 `dispatchRoute`** 分发，
 * 同时证明 `/v1/goals` 不会被更早的领域路由吞掉。
 */
describe('/v1/goals：route-table 注册', () => {
  /**
   * **忠实模拟生产**：`LocalHTTPService` 传给 `dispatchRoute` 的 `url` 已
   * `split('?')[0]`（`LocalHTTPService.ts:380`），查询串只存在于 `req.url`。
   * 若此处把带查询串的 url 直接透传给 `dispatchRoute`，测试就会**掩盖**
   * "查询参数在生产失效"这类缺陷。
   */
  async function viaRouteTable(
    method: string,
    url: string,
    jsonBody?: unknown
  ): Promise<{ status: number; matched: boolean }> {
    const { res, read } = createRes();
    const matched = await dispatchRoute(
      createReq(method, url, jsonBody),
      res,
      url.split('?')[0],
      noopBroadcast,
      ctx
    );
    return { status: read().status, matched };
  }

  test('POST 经路由表命中 goal-routes（201，非被吞掉）', async () => {
    installStore();
    const r = await viaRouteTable('POST', '/v1/goals', {
      objective: '经路由表创建',
    });
    expect(r.matched).toBe(true);
    expect(r.status).toBe(201);
  });

  test('GET 经路由表命中 goal-routes（200）', async () => {
    installStore();
    const r = await viaRouteTable('GET', '/v1/goals?active=1');
    expect(r.matched).toBe(true);
    expect(r.status).toBe(200);
  });

  test('查询串在生产形态下仍生效（路由 url 已去查询串，靠 req.url 恢复）', async () => {
    installStore();
    // 生产形态：dispatchRoute 只收到 `/v1/goals`，查询串在 req.url 上
    const created = await viaRouteTable('POST', '/v1/goals', {
      objective: '查询串回归',
      sessionId: 'sess-query-1',
    });
    expect(created.status).toBe(201);

    const bySession = await viaRouteTable(
      'GET',
      '/v1/goals?sessionId=sess-query-1'
    );
    expect(bySession.status).toBe(200);

    // 修复前：`url` 上无查询串 ⇒ 走到"无 sessionId 且无 active"分支 ⇒ 400
    const noParam = await viaRouteTable('GET', '/v1/goals');
    expect(noParam.status).toBe(400);
  });
});
