/**
 * WorkflowTemplateStore 测试（P2-1 落盘部分；台账 S24 ①）
 *
 * 锁定"用户自定义模板**确实落盘**"这一核心修复：
 * 原实现是模块私有内存 Map（`workflow-template-handlers.ts` 的 `userTemplates`），
 * 进程重启即丢失。本测试以**独立 DB 路径 + 跨实例重开**证明数据落在 SQLite，
 * 而非进程内存（跨实例用例是关键断言）。
 *
 * 规格：`.trae/specs/workflow-template-persistence.md`
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { WorkflowTemplateStore } from '../../src/workspace/WorkflowTemplateStore';
import type { WorkflowTemplate } from '../../src/workspace/types';

const createdPaths: string[] = [];

function makeDbPath(): string {
  const path = join(
    tmpdir(),
    `workflow-templates-${randomUUID().slice(0, 8)}.db`
  );
  createdPaths.push(path);
  return path;
}

afterEach(() => {
  while (createdPaths.length > 0) {
    const path = createdPaths.pop()!;
    try {
      unlinkSync(path);
    } catch {
      // @ignore-catch — 清理临时文件失败不影响断言
    }
  }
});

/** 构造一个字段完整的模板（供往返/持久化断言） */
function sampleTemplate(id = 'user_test_1'): WorkflowTemplate {
  return {
    id,
    name: '发版流程',
    description: '打包 → 校验 → 发布',
    category: 'release',
    steps: [
      { id: 'build', name: '打包', description: '构建产物', type: 'auto' },
      {
        id: 'publish',
        name: '发布',
        description: '推送制品',
        type: 'manual',
        dependsOn: ['build'],
        suggestedAgentRole: 'coder',
        estimatedMinutes: 15,
      },
    ],
    author: 'user',
    isPublic: true,
    usageCount: 7,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T03:04:05.000Z',
    tags: ['release', 'ci'],
  };
}

describe('WorkflowTemplateStore：初始化', () => {
  test('init 幂等 —— 重复调用不抛错，list 为空', async () => {
    const store = new WorkflowTemplateStore(makeDbPath());
    await store.init();
    await store.init(); // 幂等

    expect(await store.list()).toHaveLength(0);
    store.close();
  });
});

describe('WorkflowTemplateStore：字段往返', () => {
  test('upsert ⇒ get 全字段完整往返（steps / tags 经 JSON 存取不失真）', async () => {
    const store = new WorkflowTemplateStore(makeDbPath());
    await store.init();

    const template = sampleTemplate();
    await store.upsert(template);

    const loaded = await store.get(template.id);
    expect(loaded).toEqual(template);

    store.close();
  });

  test('get 未命中 ⇒ null', async () => {
    const store = new WorkflowTemplateStore(makeDbPath());
    await store.init();

    expect(await store.get('no-such-id')).toBeNull();
    store.close();
  });
});

describe('WorkflowTemplateStore：持久化（核心）', () => {
  test('跨实例持久化 —— 新建 store 读同一 DB 仍能取到', async () => {
    const path = makeDbPath();

    const first = new WorkflowTemplateStore(path);
    await first.init();
    await first.upsert(sampleTemplate('user_persist'));
    first.close();

    // "重启"：全新实例、同一 DB 文件
    const second = new WorkflowTemplateStore(path);
    await second.init();
    const loaded = await second.get('user_persist');

    expect(loaded?.name).toBe('发版流程');
    expect(loaded?.steps).toHaveLength(2);
    second.close();
  });

  test('同 id 覆盖 —— upsert 两次不产生重复行', async () => {
    const store = new WorkflowTemplateStore(makeDbPath());
    await store.init();

    await store.upsert(sampleTemplate('user_dup'));
    await store.upsert({ ...sampleTemplate('user_dup'), name: '改名后' });

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('改名后');

    store.close();
  });
});

describe('WorkflowTemplateStore：删除', () => {
  test('remove —— 首次 true，再次 false（供 handler 404 判定）', async () => {
    const store = new WorkflowTemplateStore(makeDbPath());
    await store.init();

    await store.upsert(sampleTemplate('user_del'));
    expect(await store.remove('user_del')).toBe(true);
    expect(await store.remove('user_del')).toBe(false);
    expect(await store.get('user_del')).toBeNull();

    store.close();
  });
});

describe('WorkflowTemplateStore：同步快照（P1-19 ② seam 桥接）', () => {
  test('init 后即可 `listSync()`（非空预热不成漏洞）；upsert / remove 同步维护', async () => {
    const path = makeDbPath();
    const seeded = new WorkflowTemplateStore(path);
    await seeded.init();
    await seeded.upsert(sampleTemplate('user_snap'));
    seeded.close();

    // 新实例：**仅 init**（不调 list）⇒ 快照也应已由 doInit 预热（否则 seam 会静默看不到模板）
    const store = new WorkflowTemplateStore(path);
    await store.init();
    expect(store.listSync().map((t) => t.id)).toEqual(['user_snap']);

    // upsert ⇒ 同步可见（置于最前，与 list() 的 updated_at DESC 语义一致）
    await store.upsert(sampleTemplate('user_snap2'));
    expect(store.listSync().map((t) => t.id)).toEqual([
      'user_snap2',
      'user_snap',
    ]);

    // 同 id 覆盖 ⇒ 不重复
    await store.upsert({ ...sampleTemplate('user_snap'), name: '改名后' });
    expect(store.listSync()).toHaveLength(2);
    expect(store.listSync().find((t) => t.id === 'user_snap')?.name).toBe(
      '改名后'
    );

    // remove ⇒ 同步移除
    await store.remove('user_snap');
    expect(store.listSync().map((t) => t.id)).toEqual(['user_snap2']);

    store.close();
  });
});
