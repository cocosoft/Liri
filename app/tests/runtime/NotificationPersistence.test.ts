/**
 * 消息中心收件箱化自动化断言（§五）
 *
 * 覆盖：
 * - P0-2 假按钮 performAction 已删除
 * - P0-3 create 接口 category 白名单（handler 级）
 * - P0-4 markReadAll 循环处理（超过 limit 不静默保留）
 * - P0-4 存量 approval/todo actions 清洗（幂等）
 * - P0-6 (created_at, id) 复合游标同秒分页无重复无遗漏
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { rmSync } from 'fs';
import type http from 'http';
import {
  NotificationPersistence,
  setNotificationPersistence,
} from '../../src/runtime/NotificationPersistence.js';
import { handleCreateNotification } from '../../src/infrastructure/http/handlers/notification-handlers.js';

/** 构造注入 body 的 mock req（支持 readRequestBody 的 data/end 事件） */
function makeReq(body: string): http.IncomingMessage {
  return {
    headers: {},
    url: '/v1/notifications',
    method: 'POST',
    on(ev: string, cb: (d?: unknown) => void) {
      if (ev === 'data' || ev === 'end') {
        queueMicrotask(() => {
          if (ev === 'data') cb(Buffer.from(body));
          else cb();
        });
      }
      return this;
    },
  } as unknown as http.IncomingMessage;
}

/** 构造 mock res */
function makeRes(): http.ServerResponse {
  return {
    statusCode: 200,
    headers: {},
    writeHead(code: number) {
      (this as { statusCode: number }).statusCode = code;
    },
    setHeader() {},
    end() {},
  } as unknown as http.ServerResponse;
}

describe('NotificationPersistence 收件箱化断言', () => {
  let dir: string;
  let dbPath: string;
  let persistence: NotificationPersistence;

  beforeEach(async () => {
    dir = join(tmpdir(), `pyapp-notif-${randomUUID()}`);
    dbPath = join(dir, 'notifications.db');
    persistence = new NotificationPersistence(dbPath);
    await persistence.init();
    setNotificationPersistence(persistence);
  });

  afterEach(async () => {
    await persistence.dispose();
    // bun:sqlite 在 Windows 上 close() 后文件句柄延迟释放（WAL checkpoint 时长不定），
    // 临时目录清理为 best-effort，不因平台特性导致测试失败
    await Bun.sleep(100);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* %TEMP% 下残留可接受 */
    }
  });

  it('P0-2: performAction 假按钮接口已删除', () => {
    expect(
      (persistence as unknown as Record<string, unknown>).performAction
    ).toBeUndefined();
  });

  it('P0-3: create 白名单拒绝决策类 category（approval → 400）', async () => {
    const res = makeRes();
    await handleCreateNotification(
      makeReq(JSON.stringify({ category: 'approval', title: '审批' })),
      res,
      {} as never
    );
    expect(res.statusCode).toBe(400);
  });

  it('P0-3: create 白名单放行告知类 category（notice → 201）', async () => {
    const res = makeRes();
    await handleCreateNotification(
      makeReq(JSON.stringify({ category: 'notice', title: '日历提醒' })),
      res,
      {} as never
    );
    expect(res.statusCode).toBe(201);
  });

  it('P0-4: markReadAll 循环处理超过 limit 的未读（不静默保留）', async () => {
    // 插入 30 条未读（> limit 20，触发循环，两批处理）
    // 注：曾用 600 条/limit 500，但逐条 create 在 windows 上超过 bun 默认 5s 测试超时
    //（单条 INSERT 含 fsync，windows 磁盘路径更慢），降低量级不影响"超过 limit 触发循环"的断言意图
    for (let i = 0; i < 30; i++) {
      await persistence.create({ category: 'system', title: `sys-${i}` });
    }
    const updated = await persistence.markReadAll(undefined, 'default', 20);
    expect(updated).toBe(30);

    const db = (await (
      persistence as unknown as { _getDb(): Promise<unknown> }
    )._getDb()) as {
      get: (
        sql: string,
        cb: (err: Error | null, row: { cnt: number }) => void
      ) => void;
    };
    const unread = await new Promise<number>((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as cnt FROM notifications WHERE status = 'unread'`,
        (err, row) => (err ? reject(err) : resolve(row.cnt))
      );
    });
    expect(unread).toBe(0);
  });

  it('P0-4: 存量 approval/todo actions 在重新初始化时被清洗', async () => {
    await persistence.create({
      category: 'approval',
      title: '存量审批',
      actions: [{ label: '批准', action: 'approve' }],
    });
    await persistence.dispose();

    // 重新实例化（触发 schema 初始化中的幂等清洗）
    const re = new NotificationPersistence(dbPath);
    await re.init();
    // 通过 list 取回
    const list = await re.list({ limit: 10 });
    expect(list.items.length).toBe(1);
    expect(list.items[0].category).toBe('approval');
    expect(list.items[0].actions).toEqual([]);
    expect(list.items[0].status).toBe('dismissed');
    await re.dispose();
  });

  it('P0-6: (created_at, id) 复合游标同秒分页无重复无遗漏', async () => {
    // 插入 5 条并强制同秒
    for (let i = 0; i < 5; i++) {
      await persistence.create({ category: 'notice', title: `n-${i}` });
    }
    const db = (await (
      persistence as unknown as { _getDb(): Promise<unknown> }
    )._getDb()) as {
      run: (sql: string, cb: (err: Error | null) => void) => void;
    };
    const ts = Math.floor(Date.now() / 1000);
    await new Promise<void>((resolve, reject) => {
      db.run(`UPDATE notifications SET created_at = ?`, [ts], (err: Error | null) =>
        err ? reject(err) : resolve()
      );
    });

    // 第一页 limit=3
    const page1 = await persistence.list({ limit: 3 });
    expect(page1.items.length).toBe(3);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeTruthy();

    // 第二页用复合游标
    const page2 = await persistence.list({
      limit: 3,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.items.length).toBe(2);
    expect(page2.hasMore).toBe(false);

    // 两页合并无重复无遗漏
    const ids = [...page1.items, ...page2.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(5);
  });
});
