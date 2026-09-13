/**
 * InboxManager 单元测试
 *
 * 覆盖 submit/reply/get/list/count/expireOlderThan。
 * 使用 :memory: 数据库隔离各测试。
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { InboxManager } from '../InboxManager.js';
import type { InboxItemType, InboxItemStatus } from '../InboxManager.js';

function createManager(): InboxManager {
  return new InboxManager(':memory:');
}

describe('InboxManager', () => {
  // ─── submit ──────────────────────────────────────────

  describe('submit', () => {
    test('提交审批项，返回完整 InboxItem', async () => {
      const mgr = createManager();
      const item = await mgr.submit({
        sessionId: 's1',
        type: 'approval',
        title: 'PDCA 计划审批',
        message: '请审核重构计划',
        options: ['approve', 'reject'],
        offlineCapable: true,
        source: 'pdca',
      });

      expect(item.id).toBeString();
      expect(item.sessionId).toBe('s1');
      expect(item.type).toBe('approval');
      expect(item.title).toBe('PDCA 计划审批');
      expect(item.status).toBe('pending');
      expect(item.options).toEqual(['approve', 'reject']);
      expect(item.createdAt).toBeGreaterThan(0);
      expect(item.updatedAt).toBe(item.createdAt);
    });

    test('提交 question 类型，optionless', async () => {
      const mgr = createManager();
      const item = await mgr.submit({
        sessionId: 's2',
        type: 'question',
        title: '确认删除',
        message: '确定要删除所有缓存吗？',
        offlineCapable: false,
        source: 'knowledge',
      });

      expect(item.type).toBe('question');
      expect(item.options).toBeUndefined();
      expect(item.offlineCapable).toBe(false);
      expect(item.status).toBe('pending');
    });
  });

  // ─── get ─────────────────────────────────────────────

  describe('get', () => {
    test('根据 id 获取已提交项', async () => {
      const mgr = createManager();
      const submitted = await mgr.submit({
        sessionId: 's3',
        type: 'authorization',
        title: '授权访问',
        message: '请求访问 files/ 目录',
        offlineCapable: true,
        source: 'security',
      });

      const fetched = await mgr.get(submitted.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(submitted.id);
      expect(fetched!.type).toBe('authorization');
      expect(fetched!.status).toBe('pending');
    });

    test('不存在的 id 返回 null', async () => {
      const mgr = createManager();
      const result = await mgr.get('non-existent-id');
      expect(result).toBeNull();
    });
  });

  // ─── reply ───────────────────────────────────────────

  describe('reply', () => {
    test('回复 pending 状态项 → status 变为 replied', async () => {
      const mgr = createManager();
      const item = await mgr.submit({
        sessionId: 's4',
        type: 'approval',
        title: '测试审批',
        message: 'body',
        offlineCapable: true,
        source: 'test',
      });

      const replied = await mgr.reply(item.id, '批准执行');
      expect(replied).not.toBeNull();
      expect(replied!.status).toBe('replied');
      expect(replied!.reply).toBe('批准执行');
      expect(replied!.repliedAt).toBeGreaterThan(0);

      // 再次 fetch 确认持久化
      const fetched = await mgr.get(item.id);
      expect(fetched!.status).toBe('replied');
      expect(fetched!.repliedAt).toBe(replied!.repliedAt);
    });

    test('回复非 pending 状态项 → 返回 null', async () => {
      const mgr = createManager();
      const item = await mgr.submit({
        sessionId: 's5',
        type: 'approval',
        title: '已回复过',
        message: 'x',
        offlineCapable: true,
        source: 'test',
      });

      await mgr.reply(item.id, '首次回复');
      const secondReply = await mgr.reply(item.id, '二次回复');
      expect(secondReply).toBeNull();
    });

    test('回复不存在的 id → 返回 null', async () => {
      const mgr = createManager();
      const result = await mgr.reply('ghost-id', '回复');
      expect(result).toBeNull();
    });
  });

  // ─── list ────────────────────────────────────────────

  describe('list', () => {
    test('无过滤条件返回全部项，支持分页', async () => {
      const mgr = createManager();
      for (let i = 0; i < 5; i++) {
        await mgr.submit({
          sessionId: 's' + i,
          type: 'approval',
          title: `审批 ${i}`,
          message: `消息 ${i}`,
          offlineCapable: true,
          source: 'test',
        });
      }

      const result = await mgr.list();
      expect(result.total).toBe(5);
      expect(result.items.length).toBe(5);
      // 按 created_at DESC 排序
      expect(result.items[0].title).toBe('审批 4');
    });

    test('按 sessionId 过滤', async () => {
      const mgr = createManager();
      await mgr.submit({
        sessionId: 'sa',
        type: 'approval',
        title: 'A',
        message: 'a',
        offlineCapable: true,
        source: 'test',
      });
      await mgr.submit({
        sessionId: 'sb',
        type: 'question',
        title: 'B',
        message: 'b',
        offlineCapable: true,
        source: 'test',
      });

      const result = await mgr.list({ sessionId: 'sa' });
      expect(result.total).toBe(1);
      expect(result.items[0].title).toBe('A');
    });

    test('按 status 过滤', async () => {
      const mgr = createManager();
      const item = await mgr.submit({
        sessionId: 'sx',
        type: 'approval',
        title: '待处理',
        message: 'm',
        offlineCapable: true,
        source: 'test',
      });
      await mgr.reply(item.id, 'done');

      const pending = await mgr.list({ status: 'pending' });
      const replied = await mgr.list({ status: 'replied' });

      expect(pending.total).toBe(0);
      expect(replied.total).toBe(1);
    });

    test('按 type 过滤', async () => {
      const mgr = createManager();
      await mgr.submit({
        sessionId: 's1',
        type: 'approval',
        title: 'A',
        message: 'm',
        offlineCapable: true,
        source: 'test',
      });
      await mgr.submit({
        sessionId: 's2',
        type: 'question',
        title: 'Q',
        message: 'm',
        offlineCapable: true,
        source: 'test',
      });

      const approvals = await mgr.list({ type: 'approval' });
      const questions = await mgr.list({ type: 'question' });

      expect(approvals.total).toBe(1);
      expect(questions.total).toBe(1);
    });

    test('limit + offset 分页', async () => {
      const mgr = createManager();
      for (let i = 0; i < 10; i++) {
        await mgr.submit({
          sessionId: 's',
          type: 'approval',
          title: `审批 ${String(i).padStart(2, '0')}`,
          message: `m`,
          offlineCapable: true,
          source: 'test',
        });
      }

      const page = await mgr.list({ limit: 3, offset: 2 });
      expect(page.items.length).toBe(3);
      expect(page.total).toBe(10);
    });
  });

  // ─── getPendingCount ─────────────────────────────────

  describe('getPendingCount', () => {
    test('初始为 0', async () => {
      const mgr = createManager();
      const count = await mgr.getPendingCount();
      expect(count).toBe(0);
    });

    test('提交 3 项后返回 3', async () => {
      const mgr = createManager();
      for (let i = 0; i < 3; i++) {
        await mgr.submit({
          sessionId: 's',
          type: 'approval',
          title: `审批 ${i}`,
          message: 'm',
          offlineCapable: true,
          source: 'test',
        });
      }

      expect(await mgr.getPendingCount()).toBe(3);
    });

    test('回复 1 项后计数减 1', async () => {
      const mgr = createManager();
      const item = await mgr.submit({
        sessionId: 's',
        type: 'approval',
        title: '审批',
        message: 'm',
        offlineCapable: true,
        source: 'test',
      });
      await mgr.submit({
        sessionId: 's',
        type: 'question',
        title: '问题',
        message: 'm',
        offlineCapable: true,
        source: 'test',
      });

      expect(await mgr.getPendingCount()).toBe(2);

      await mgr.reply(item.id, 'ok');
      expect(await mgr.getPendingCount()).toBe(1);
    });

    test('按 sessionId 过滤', async () => {
      const mgr = createManager();
      await mgr.submit({
        sessionId: 'sa',
        type: 'approval',
        title: '审批',
        message: 'm',
        offlineCapable: true,
        source: 'test',
      });
      await mgr.submit({
        sessionId: 'sb',
        type: 'approval',
        title: '审批',
        message: 'm',
        offlineCapable: true,
        source: 'test',
      });

      expect(await mgr.getPendingCount('sa')).toBe(1);
    });
  });

  // ─── expireOlderThan ─────────────────────────────────

  describe('expireOlderThan', () => {
    test('过期的 pending 项标记为 expired', async () => {
      const mgr = createManager();
      // 通过直接写 DB 模拟过去的时间（该管理器层我们不直接暴露时间伪造）
      // 替代方案：提交一个旧项，设置 maxAgeMs=0 使所有 pending 项过期
      const item = await mgr.submit({
        sessionId: 's',
        type: 'approval',
        title: '过期审批',
        message: 'm',
        offlineCapable: true,
        source: 'test',
      });

      // 等 1ms 确保 created_at < Date.now()
      await new Promise((r) => setTimeout(r, 1));
      const expiredCount = await mgr.expireOlderThan(0); // 0ms = 所有 pending 都过期
      expect(expiredCount).toBeGreaterThanOrEqual(1);

      const fetched = await mgr.get(item.id);
      expect(fetched!.status).toBe('expired');
    });

    test('超长 maxAge 不使新项过期', async () => {
      const mgr = createManager();
      await mgr.submit({
        sessionId: 's',
        type: 'approval',
        title: '新审批',
        message: 'm',
        offlineCapable: true,
        source: 'test',
      });

      const expiredCount = await mgr.expireOlderThan(86400_000); // 1 day
      expect(expiredCount).toBe(0);
    });

    test('已回复的项不受过期影响', async () => {
      const mgr = createManager();
      const item = await mgr.submit({
        sessionId: 's',
        type: 'approval',
        title: '已回复',
        message: 'm',
        offlineCapable: true,
        source: 'test',
      });
      await mgr.reply(item.id, 'ok');

      const expiredCount = await mgr.expireOlderThan(0);
      expect(expiredCount).toBe(0);

      const fetched = await mgr.get(item.id);
      expect(fetched!.status).toBe('replied');
    });
  });

  // ─── 完整性测试 ──────────────────────────────────────

  describe('端到端工作流', () => {
    test('submit → list → getPendingCount → reply → expired 不影响已回复', async () => {
      const mgr = createManager();

      // 1. 提交 2 项
      const item1 = await mgr.submit({
        sessionId: 'workflow',
        type: 'approval',
        title: '审批 A',
        message: 'm',
        offlineCapable: true,
        source: 'pdca',
      });
      const item2 = await mgr.submit({
        sessionId: 'workflow',
        type: 'question',
        title: '问题 B',
        message: 'm',
        offlineCapable: true,
        source: 'knowledge',
      });

      // 2. 验证列表
      const all = await mgr.list({ sessionId: 'workflow' });
      expect(all.total).toBe(2);

      // 3. 验证待处理计数
      expect(await mgr.getPendingCount('workflow')).toBe(2);

      // 4. 回复一项
      const replied = await mgr.reply(item1.id, '通过');
      expect(replied!.status).toBe('replied');
      expect(await mgr.getPendingCount('workflow')).toBe(1);

      // 5. 过期不影响已回复项（等 1ms 确保 created_at < Date.now()）
      await new Promise((r) => setTimeout(r, 1));
      await mgr.expireOlderThan(0);
      expect((await mgr.get(item1.id))!.status).toBe('replied');
      expect((await mgr.get(item2.id))!.status).toBe('expired');
    });
  });
});
