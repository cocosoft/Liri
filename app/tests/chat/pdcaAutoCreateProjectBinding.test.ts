/**
 * 2026-10-31 P1：自动建项目的**归属守卫**（会话/项目隔离缺陷 R1）。
 *
 * 真机事故：`autoCreateProject` 在"去重命中"与"新建"两个分支里**无条件**写
 * `session.metadata.projectId`，且候选集在工作区缺省时取 `default`、匹配用的是
 * 项目名 Jaccard 相似度 ⇒ 3 个不同目录的会话被改写成同一个垃圾项目
 * `proj_1793402819293_54c217`（项目名 = AlwaysOn 系统提示词原文）。
 *
 * 本文件锁定五道守卫（方案 §三 P1）：
 *  ① `deliverables <= 0` ⇒ 不建项目；
 *  ② 系统提示类文本（`你是 …`）不得成为项目名（回退 `项目 N 个产出`）；
 *  ③ 已有归属且与命中项不一致 ⇒ 不覆盖（保留原归属 + warn）；
 *  ④ 会话工作区与命中项目不一致 ⇒ 不跨工作区关联；
 *  ⑤ 已有归属但无命中 ⇒ 不新建（防"每轮多一个项目"）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { PdcaLaunchCoordinator } from '../../src/chat/manager/pdcaLaunch.js';
import { createProjectStore } from '../../src/workspace/ProjectStore.js';
import { WorkItemStore } from '../../src/workspace/WorkItemStore.js';
import type { ChatSession } from '../../src/session/types/session.js';

let root: string;
let prevDataDir: string | undefined;

function makeCoordinator() {
  const persisted: string[] = [];
  const coordinator = new PdcaLaunchCoordinator({
    launchingSessions: new Set<string>(),
    getPdcaLauncher: () => null,
    shouldUsePlanDrivenLoop: () => true,
    shouldUseCodeMode: () => false,
    getOrCreateTAORLoop: () =>
      ({ applyVerifierConfig: () => {} }) as unknown as never,
    getStreamTailSeq: async () => 1,
    appendStreamEvent: async () => undefined,
    persistSessionMetadata: async (session) => {
      persisted.push(String(session.metadata?.projectId ?? ''));
    },
    recentUserText: () => '',
    lastAssistantText: () => '',
  });
  return { coordinator, persisted };
}

function store() {
  return createProjectStore(root, new WorkItemStore(root));
}

function seedProject(
  name: string,
  workspaceId = 'default',
  description = ''
): { id: string; workspaceId: string; name: string } {
  return store().create({
    workspaceId,
    name,
    description,
    delaySandbox: true,
  });
}

function makeSession(metadata: Record<string, unknown> = {}): ChatSession {
  return {
    id: 'session_p1_binding',
    metadata: { title: '测试会话', ...metadata },
  } as unknown as ChatSession;
}

beforeEach(() => {
  prevDataDir = process.env.LIRI_DATA_DIR;
  root = mkdtempSync(join(tmpdir(), 'liri-pdca-binding-'));
  process.env.LIRI_DATA_DIR = root;
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevDataDir;
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows 偶发 EBUSY：留给系统清理
  }
});

describe('P1 守卫③：已有归属 + 命中他人项目 ⇒ 不覆盖', () => {
  it('保留原 projectId，只告警，不写回、不新建', async () => {
    // 去重匹配读 `description ?? name`；真实项目无论自动建还是手动建都带 description，
    // 故这里按真实形态种一条 description（与 name 同文）。
    const seeded = seedProject('数据分析平台', 'default', '数据分析平台');
    const session = makeSession({ projectId: 'proj_other_owner' });
    const { coordinator, persisted } = makeCoordinator();

    const returned = await coordinator.autoCreateProject(session, undefined, {
      hasGoal: true,
      deliverables: 2,
      goalSummary: '数据分析平台',
    });

    expect(returned).toBe('proj_other_owner');
    expect(session.metadata.projectId).toBe('proj_other_owner');
    expect(persisted).toEqual([]);
    expect(
      store()
        .list('default')
        .map((p) => p.id)
    ).toEqual([seeded.id]);
  });
});

describe('P1 守卫④：工作区不一致 ⇒ 不跨工作区关联', () => {
  it('worktree 形态 workspaceId=wt-* ⇒ 不关联到 default 的 proj_*', async () => {
    const seeded = seedProject('数据分析平台', 'default', '数据分析平台');
    const session = makeSession({ workspaceId: 'wt-1793076074299-dout54' });
    const { coordinator } = makeCoordinator();

    const returned = await coordinator.autoCreateProject(session, undefined, {
      hasGoal: true,
      deliverables: 2,
      goalSummary: '数据分析平台',
    });

    expect(returned).not.toBe(seeded.id);
    expect(session.metadata.projectId).not.toBe(seeded.id);
    expect(
      store()
        .list('default')
        .map((p) => p.id)
    ).toEqual([seeded.id]);
  });
});

describe('P1 守卫②：系统提示类文本不得成为项目名', () => {
  it('「你是 …」模板句 ⇒ 项目名回退为「项目 N 个产出」，描述也不落提示词', async () => {
    const session = makeSession();
    const { coordinator } = makeCoordinator();

    await coordinator.autoCreateProject(session, undefined, {
      hasGoal: true,
      deliverables: 3,
      goalSummary: '你是 AlwaysOn 自主执行器的「发现阶段」。 项目:我',
    });

    const created = store().list('default');
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe('项目 3 个产出');
    expect(created[0].description).toBe('自动创建：3 个产出物');
    expect(created[0].description).not.toContain('AlwaysOn');
  });
});

describe('P1 正常路径', () => {
  it('无归属 + 命中同工作区项目 ⇒ 关联且持久化', async () => {
    const seeded = seedProject('数据可视化大盘', 'default', '数据可视化大盘');
    const session = makeSession();
    const { coordinator, persisted } = makeCoordinator();

    const returned = await coordinator.autoCreateProject(session, undefined, {
      hasGoal: true,
      deliverables: 1,
      goalSummary: '数据可视化大盘',
    });

    expect(returned).toBe(seeded.id);
    expect(session.metadata.projectId).toBe(seeded.id);
    expect(persisted).toEqual([seeded.id]);
  });

  it('无归属 + 无命中 ⇒ 新建并关联', async () => {
    const session = makeSession();
    const { coordinator } = makeCoordinator();

    const returned = await coordinator.autoCreateProject(session, undefined, {
      hasGoal: true,
      deliverables: 2,
      goalSummary: '全新的渲染引擎',
    });

    expect(returned?.startsWith('proj_')).toBe(true);
    expect(session.metadata.projectId).toBe(returned);
    expect(store().list('default')).toHaveLength(1);
  });
});

describe('P1 守卫①/⑤：不做无意义的新建', () => {
  it('deliverables = 0 ⇒ 返回 null 且不建项目', async () => {
    const session = makeSession();
    const { coordinator } = makeCoordinator();

    const returned = await coordinator.autoCreateProject(session, undefined, {
      hasGoal: true,
      deliverables: 0,
      goalSummary: '只有目标没有产出',
    });

    expect(returned).toBeNull();
    expect(store().list('default')).toHaveLength(0);
  });

  it('同一会话重复触发（目标已变、无命中）⇒ 不产生第二个项目（幂等）', async () => {
    const session = makeSession();
    const { coordinator } = makeCoordinator();

    const first = await coordinator.autoCreateProject(session, undefined, {
      hasGoal: true,
      deliverables: 2,
      goalSummary: '第一轮目标：报表导出',
    });
    const second = await coordinator.autoCreateProject(session, undefined, {
      hasGoal: true,
      deliverables: 4,
      goalSummary: '第二轮目标：完全不同的东西',
    });

    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(session.metadata.projectId).toBe(first);
    expect(store().list('default')).toHaveLength(1);
  });
});
