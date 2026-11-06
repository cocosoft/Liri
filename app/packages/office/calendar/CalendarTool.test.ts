/**
 * CalendarTool 集成测试
 * 验证增删改查 + .ics 文件读写
 * 使用临时目录隔离测试数据
 *
 * 2026-11-06 修复：此前设的是 `PYAPP_HOME`（**已弃用别名，`resolvePyappHome()` 不读**）
 * ⇒ 用例实际把 `测试会议 / 旧标题 / 待删除 / Alice 生日聚会` 等 fixture 写进**生产**日历目录
 * `~/.pyapp/office/calendars/`，随后被运行中的应用当作真实日程消费（生成 source_triggers /
 * workitems / pending_proactive_pushes / 通知）。现改用契约键 `LIRI_HOME`
 *（`productEnvKey('HOME')`，见 `packages/kernel/src/core/productIdentity.ts`）。
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const testHome = path.join(os.tmpdir(), 'pyapp-cal-test-' + Date.now());
const HOME_KEY = 'LIRI_HOME';
let originalHome: string | undefined;

beforeEach(() => {
  if (fs.existsSync(testHome)) fs.rmSync(testHome, { recursive: true });
  fs.mkdirSync(testHome, { recursive: true });
  originalHome = process.env[HOME_KEY];
  process.env[HOME_KEY] = testHome;
});

afterEach(() => {
  if (fs.existsSync(testHome)) fs.rmSync(testHome, { recursive: true });
  if (originalHome === undefined) delete process.env[HOME_KEY];
  else process.env[HOME_KEY] = originalHome;
});

describe('CalendarTool', () => {
  test('add + list 往返', async () => {
    const { CalendarTool } = await import('./CalendarTool');
    const cal = new CalendarTool();

    const event = await cal.add({
      summary: '测试会议',
      start: '2026-07-20T09:00:00Z',
      end: '2026-07-20T10:00:00Z',
    });

    expect(event.summary).toBe('测试会议');
    expect(event.id).toStartWith('event-');

    const events = await cal.list();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.summary === '测试会议')).toBe(true);
  });

  test('update 修改日程', async () => {
    const { CalendarTool } = await import('./CalendarTool');
    const cal = new CalendarTool();

    const event = await cal.add({
      summary: '旧标题',
      start: '2026-07-20T09:00:00Z',
      end: '2026-07-20T10:00:00Z',
    });

    await cal.update(event.id, { summary: '新标题' });

    const events = await cal.list();
    const updated = events.find((e) => e.id === event.id);
    expect(updated?.summary).toBe('新标题');
  });

  test('delete 删除日程', async () => {
    const { CalendarTool } = await import('./CalendarTool');
    const cal = new CalendarTool();

    const event = await cal.add({
      summary: '待删除',
      start: '2026-07-20T09:00:00Z',
      end: '2026-07-20T10:00:00Z',
    });

    await cal.delete(event.id);

    const events = await cal.list();
    expect(events.find((e) => e.id === event.id)).toBeUndefined();
  });

  test('search 搜索日程', async () => {
    const { CalendarTool } = await import('./CalendarTool');
    const cal = new CalendarTool();

    await cal.add({
      summary: 'Alice 生日聚会',
      start: '2026-07-20T09:00:00Z',
      end: '2026-07-20T10:00:00Z',
      description: '记得买蛋糕和气球',
    });

    const r1 = await cal.search('生日');
    expect(r1.length).toBeGreaterThanOrEqual(1);

    const r2 = await cal.search('不存在的关键词');
    expect(r2.length).toBe(0);
  });

  test('list 按文件系统遍历（无排序保证），handler 层应自行排序', async () => {
    const { CalendarTool } = await import('./CalendarTool');
    const cal = new CalendarTool();

    await cal.add({
      summary: 'B',
      start: '2026-08-01T00:00:00Z',
      end: '2026-08-01T01:00:00Z',
    });
    await cal.add({
      summary: 'A',
      start: '2026-07-01T00:00:00Z',
      end: '2026-07-01T01:00:00Z',
    });

    const events = await cal.list();
    // CalendarTool.list() 不保证排序，handler 层负责 sort()
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});
