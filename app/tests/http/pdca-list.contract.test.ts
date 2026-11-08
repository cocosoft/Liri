// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * POST /v1/pdca/list 契约测试（1-5 P1 前置，2026-09-03）
 * 验证：checkpoint 回退（无内存 orchestrator 时列表非空）+ projectId/sessionId/workspaceId
 * 过滤 + checkpoint-only 条目 source 标记。
 *
 * **隔离机制（2026-09-29 台账「另案 ⑤」修正）**：`LIRI_HOME` 指向临时目录。
 * ⚠️ 该隔离**此前形同虚设** —— `pdca-handlers` / `PdcaWorkItemBridge` 的检查点目录曾是
 * **模块顶层常量**，被 `bunfig.toml` 的 preload 链**先行求值并冻结**到真实
 * `~/.pyapp/data/pdca`（实测 **3394** 个 json）⇒ 本测试实际**读写真实数据**，且每次调用
 * 全量扫描 ≈**1.2s**（≥2 次调用的用例即越过 bun 默认 5s 超时 ⇒ 偶发红灯）。
 * 已把两处目录改为**调用时解析**（见 `pdca-handlers.ts` 的 `pdcaCheckpointDir()`），
 * 本测试现在**真正**落在临时目录，单次调用 ≈**ms**。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import type http from 'http';

const isolateDir = mkdtempSync(join(tmpdir(), 'pdca-list-http-'));
// 2026-10-11 修正（跨文件 env 泄漏）：记录原值并在 `afterAll` 还原 —— 否则 `LIRI_HOME`/
// `LIRI_DATA_DIR` 会泄漏给同进程后续测试文件（`resolveDataDir` 中 `LIRI_DATA_DIR`
// **优先于** `setUserDataDirOverride` ⇒ 会把它们的落盘重定向到本文件的临时目录）。
const prevLiriHome = process.env.LIRI_HOME;
const prevLiriDataDir = process.env.LIRI_DATA_DIR;
process.env.LIRI_HOME = isolateDir;
// GAI-3：checkpoint 迁入 app.db ⇒ 同时隔离数据目录（LIRI_DATA_DIR 优先于 setUserDataDirOverride）
process.env.LIRI_DATA_DIR = isolateDir;

afterAll(() => {
  if (prevLiriHome === undefined) delete process.env.LIRI_HOME;
  else process.env.LIRI_HOME = prevLiriHome;
  if (prevLiriDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevLiriDataDir;
});

const { writePdcaCheckpoint } =
  await import('../../src/tasks/PdcaWorkItemBridge');
const { handlePdcaList } =
  await import('../../src/infrastructure/http/handlers/pdca-handlers');

function createRes(): {
  res: http.ServerResponse;
  body: string;
  status: number;
} {
  const out = { body: '', status: 0 };
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
    get body() {
      return out.body;
    },
    get status() {
      return out.status;
    },
  };
}

function makeReq(body?: object): http.IncomingMessage {
  const text = body === undefined ? '' : JSON.stringify(body);
  const req = new Readable({ read() {} }) as unknown as http.IncomingMessage & {
    headers: Record<string, string>;
  };
  req.headers = {
    'content-length': String(Buffer.byteLength(text)),
    host: 'localhost',
  };
  if (text) req.push(Buffer.from(text));
  req.push(null);
  return req;
}

async function call(body?: object) {
  const created = createRes();
  await handlePdcaList(makeReq(body), created.res);
  return {
    status: created.status,
    body: JSON.parse(created.body) as {
      items: any[];
      total: number;
      limit: number;
      offset: number;
    },
  };
}

// 预写 checkpoint（模拟跨重启遗留任务，无内存 orchestrator）
await writePdcaCheckpoint('pdca_ck_a', {
  taskId: 'pdca_ck_a',
  workItemId: 'wi_a',
  status: 'running',
  description: '跨重启遗留目标',
  sessionId: 'sess_a',
  workspaceId: 'ws1',
  projectId: 'proj_x',
});
await writePdcaCheckpoint('pdca_ck_b', {
  taskId: 'pdca_ck_b',
  workItemId: 'wi_b',
  status: 'completed',
  description: '已完成目标',
  sessionId: 'sess_b',
  workspaceId: 'ws2',
  projectId: 'proj_x',
});

describe('POST /v1/pdca/list 契约（1-5 P1）', () => {
  test('无 body：返回摘要包裹结构（items/total/limit/offset）', async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    // ⚠️ 不断言 `total === 2`：`bun test` 同进程跑全部用例时，检查点表是**共享的真实 DB**，
    // 其它测试文件也会写入检查点（2026-11-08 CI ubuntu 实测 total=6）。此处只锁契约形状。
    expect(body.total).toBeGreaterThanOrEqual(2);
    // 默认上限 200（摘要化后不再全量返回）
    expect(body.limit).toBe(200);
    expect(body.offset).toBe(0);
    expect(body.items).toHaveLength(Math.min(body.total, body.limit));

    // 字段断言走 projectId 过滤（只命中本文件写入的两条，不受其它文件的检查点影响）
    const scoped = await call({ projectId: 'proj_x' });
    const a = scoped.body.items.find((t: any) => t.taskId === 'pdca_ck_a');
    expect(a).toBeDefined();
    expect(a.source).toBe('checkpoint');
    expect(a.status).toBe('running');
    expect(a.projectId).toBe('proj_x');
    expect(a.workspaceId).toBe('ws1');
    expect(a.sessionId).toBe('sess_a');
    // 摘要必须带最近活动时间（列表排序依据）
    expect(typeof a.updatedAt).toBe('string');
  });

  test('摘要不含大载荷（plan / audit / lifecycle 不得出现在列表里）', async () => {
    const { body } = await call();
    for (const item of body.items) {
      expect(item).not.toHaveProperty('plan');
      expect(item).not.toHaveProperty('audit');
      expect(item).not.toHaveProperty('lifecycle');
    }
  });

  test('?projectId=proj_x → 2 项；proj_y → 0 项', async () => {
    const x = await call({ projectId: 'proj_x' });
    expect(x.body.items.length).toBe(2);
    const y = await call({ projectId: 'proj_y' });
    expect(y.body.items.length).toBe(0);
    expect(y.body.total).toBe(0);
  });

  test('?sessionId=sess_a → 1 项', async () => {
    const { body } = await call({ sessionId: 'sess_a' });
    expect(body.items.length).toBe(1);
    expect(body.items[0].taskId).toBe('pdca_ck_a');
  });

  test('?workspaceId=ws2 → 1 项（pdca_ck_b）', async () => {
    const { body } = await call({ workspaceId: 'ws2' });
    expect(body.items.length).toBe(1);
    expect(body.items[0].taskId).toBe('pdca_ck_b');
  });

  test('limit 截断条目但 total 仍为全量；offset 跳过', async () => {
    const all = await call({ projectId: 'proj_x' });
    const limited = await call({ projectId: 'proj_x', limit: 1 });
    expect(limited.body.items.length).toBe(1);
    // total = 过滤后的**全量**（与 limit 无关）
    expect(limited.body.total).toBe(all.body.total);
    expect(limited.body.total).toBe(2);
    expect(limited.body.limit).toBe(1);

    const skipped = await call({ projectId: 'proj_x', limit: 1, offset: 1 });
    expect(skipped.body.items.length).toBe(1);
    expect(skipped.body.items[0].taskId).not.toBe(limited.body.items[0].taskId);
  });

  test('按最近活动时间倒序（刚更新的排最前）', async () => {
    // 重写 b ⇒ 其 updatedAt 变为最新（摘要排序即按此字段）
    await writePdcaCheckpoint('pdca_ck_b', { status: 'completed' });
    const { body } = await call({ projectId: 'proj_x' });
    expect(body.items[0].taskId).toBe('pdca_ck_b');
    // 全表（含其它测试文件写入的检查点）也必须保持倒序
    const times = body.items.map((t: any) =>
      t.updatedAt ? Date.parse(t.updatedAt) : 0
    );
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
