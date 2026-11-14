// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D10：成功轨迹 → SOP 草案。
 *
 * 验收（方案 §2 D10）：
 * - **草案生成可复现**：同一轨迹 ⇒ 逐字相同的正文与 id；重新蒸馏不产生重复草案；
 * - **不自动注册**：蒸馏只落草案；唯一写技能的动作是 `approve`（人工）；
 * - **拒绝率可观测**：`computeSopDraftStats().rejectedRate`（无已决草案 ⇒ `null`，不伪造 0）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSopDraft,
  buildSopMarkdown,
  distillSopDrafts,
  type SopTrajectory,
} from '../../../src/tasks/evolution/sopDistill';
import {
  computeSopDraftStats,
  SopDraftStore,
  SOP_DRAFT_APPROVED,
  SOP_DRAFT_PENDING,
  SOP_DRAFT_REJECTED,
} from '../../../src/tasks/evolution/SopDraftStore';
import {
  readCompletedPlanTrajectories,
  toSopTrajectory,
} from '../../../src/tasks/evolution/sopPlanSource';
import { createSopCommand } from '../../../src/commands/builtin/sop/Sop';

const tempDirs: string[] = [];

function makeDirs(): { drafts: string; skills: string } {
  const root = mkdtempSync(join(tmpdir(), 'sop-draft-'));
  tempDirs.push(root);
  return { drafts: join(root, 'drafts'), skills: join(root, 'skills') };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const TRAJECTORY: SopTrajectory = {
  planId: 'plan_abc',
  goalText: '把登录页改成深色主题',
  completedAt: '2026-11-14T08:00:00.000Z',
  steps: [
    { description: '读取现有样式', retryCount: 0 },
    {
      description: '替换主题变量',
      retryCount: 1,
      artifacts: ['src/theme.css'],
      acceptanceCriteria: '页面切换后无白闪',
    },
  ],
};

describe('sopDistill：确定性蒸馏', () => {
  it('同一轨迹 ⇒ 正文逐字相同、id 相同（可复现）', () => {
    const a = buildSopDraft(TRAJECTORY);
    const b = buildSopDraft({ ...TRAJECTORY });
    expect(b.markdown).toBe(a.markdown);
    expect(b.id).toBe(a.id);
    expect(a.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('正文只写轨迹事实：步骤按序、产物/纠偏仅在有值时出现', () => {
    const md = buildSopMarkdown(TRAJECTORY);
    expect(md).toContain('1. 读取现有样式');
    expect(md).toContain('2. 替换主题变量');
    expect(md).toContain('- 产物：`src/theme.css`');
    expect(md).toContain('- 纠偏：重试 1 次后通过');
    expect(md).toContain('## 验收要点');
    expect(md).toContain('**草案未注册**');
    // 首步无产物、无重试 ⇒ 不出现空壳条目
    expect(md.split('- 产物：')).toHaveLength(2);
  });

  it('轨迹内容不同 ⇒ id 不同；批量蒸馏按入参顺序并去重', () => {
    const other: SopTrajectory = { ...TRAJECTORY, planId: 'plan_def' };
    const drafts = distillSopDrafts([TRAJECTORY, TRAJECTORY, other], 5);
    expect(drafts).toHaveLength(2);
    expect(drafts[0].planId).toBe('plan_abc');
    expect(drafts[0].id).not.toBe(drafts[1].id);
  });

  it('空步骤轨迹不蒸馏', () => {
    expect(distillSopDrafts([{ ...TRAJECTORY, steps: [] }])).toEqual([]);
  });
});

describe('sopPlanSource：只认「每步都完成」的轨迹', () => {
  it('有未完成步骤 ⇒ 不是成功轨迹', () => {
    const ok = toSopTrajectory({
      id: 'p1',
      description: '目标',
      steps: [{ description: 'a', status: 'completed', retryCount: 0 }],
    });
    expect(ok?.planId).toBe('p1');

    const bad = toSopTrajectory({
      id: 'p2',
      description: '目标',
      steps: [
        { description: 'a', status: 'completed' },
        { description: 'b', status: 'failed' },
      ],
    });
    expect(bad).toBeNull();
  });

  it('缺 id / 空步骤 / 空描述 ⇒ 不入选', () => {
    expect(toSopTrajectory({ description: 'x', steps: [] })).toBeNull();
    expect(
      toSopTrajectory({
        id: 'p3',
        steps: [{ description: '  ', status: 'completed' }],
      })
    ).toBeNull();
  });

  it('读取计划目录：按完成时间倒序、坏文件跳过、limit 生效', () => {
    const { drafts: root } = makeDirs();
    const dir = join(root, 'plans');
    mkdirSync(dir, { recursive: true });

    const plan = (id: string, completedAt: string) =>
      JSON.stringify({
        id,
        description: `目标 ${id}`,
        completedAt,
        steps: [
          { description: '做点什么', status: 'completed', retryCount: 0 },
        ],
      });
    writeFileSync(
      join(dir, 'plan_old.json'),
      plan('old', '2026-11-01T00:00:00Z')
    );
    writeFileSync(
      join(dir, 'plan_new.json'),
      plan('new', '2026-11-13T00:00:00Z')
    );
    writeFileSync(join(dir, 'plan_broken.json'), '{ not json');
    writeFileSync(
      join(dir, 'plan_running.json'),
      JSON.stringify({
        id: 'running',
        description: '未完成',
        steps: [{ description: 'x', status: 'running' }],
      })
    );

    const all = readCompletedPlanTrajectories({ dir, limit: 10 });
    expect(all.map((t) => t.planId)).toEqual(['new', 'old']);
    expect(readCompletedPlanTrajectories({ dir, limit: 1 })).toHaveLength(1);
    expect(
      readCompletedPlanTrajectories({ dir: join(dir, 'missing') })
    ).toEqual([]);
  });
});

describe('SopDraftStore：草案落盘 + 人工决定', () => {
  it('保存幂等；决定后统计拒绝率', () => {
    const { drafts, skills } = makeDirs();
    const store = new SopDraftStore(drafts, skills);
    const content = buildSopDraft(TRAJECTORY);

    expect(store.save(content)).toBe('created');
    expect(store.save(content)).toBe('existing');
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].status).toBe(SOP_DRAFT_PENDING);
    // 蒸馏阶段**不写技能**
    expect(existsSync(skills)).toBe(false);

    expect(computeSopDraftStats(store.list()).rejectedRate).toBeNull();

    const rejected = store.decide(
      store.list()[0],
      SOP_DRAFT_REJECTED,
      '太具体'
    );
    expect(rejected.status).toBe(SOP_DRAFT_REJECTED);
    expect(rejected.note).toBe('太具体');

    const stats = computeSopDraftStats(store.list());
    expect(stats.rejected).toBe(1);
    expect(stats.rejectedRate).toBe(1);
  });

  it('批准：写入 SKILL.md（唯一注册动作）；同名目录存在则不覆盖', () => {
    const { drafts, skills } = makeDirs();
    const store = new SopDraftStore(drafts, skills);
    store.save(buildSopDraft(TRAJECTORY));
    const draft = store.list()[0];

    const skillPath = store.installSkill(draft);
    expect(skillPath).toBe(join(skills, `sop-${draft.id}`, 'SKILL.md'));
    const text = readFileSync(skillPath!, 'utf-8');
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toContain(`name: "sop-${draft.id}"`);
    expect(text).toContain('## 步骤');

    // 幂等 + 不覆盖：第二次安装返回 null
    expect(store.installSkill(draft)).toBeNull();
  });
});

describe('/sop 命令：HITL 全链路（注入临时目录）', () => {
  it('distill → list → reject → stats；approve 才写技能', async () => {
    const { drafts, skills } = makeDirs();
    const store = new SopDraftStore(drafts, skills);
    const command = createSopCommand({
      store,
      distill: (limit) => distillSopDrafts([TRAJECTORY], limit),
    });

    const distilled = await command.execute('distill 3', {} as never);
    expect(distilled.success).toBe(true);
    const id = store.list()[0].id;

    const listed = await command.execute('list', {} as never);
    expect(listed.message).toContain(id);
    expect(listed.message).toContain('待决 1');

    const shown = await command.execute(`show ${id.slice(0, 6)}`, {} as never);
    expect(shown.message).toContain('# SOP：');

    const rejected = await command.execute(`reject ${id} 太具体`, {} as never);
    expect(rejected.message).toContain('拒绝率 100.0%');
    expect(existsSync(skills)).toBe(false);
  });

  it('批准写入技能；已拒绝的草案不可再批准', async () => {
    const { drafts, skills } = makeDirs();
    const store = new SopDraftStore(drafts, skills);
    const command = createSopCommand({
      store,
      distill: (limit) => distillSopDrafts([TRAJECTORY], limit),
    });
    await command.execute('distill', {} as never);
    const draft = store.list()[0];

    const approved = await command.execute(`approve ${draft.id}`, {} as never);
    expect(approved.success).toBe(true);
    expect(existsSync(join(skills, `sop-${draft.id}`, 'SKILL.md'))).toBe(true);
    expect(store.list()[0].status).toBe(SOP_DRAFT_APPROVED);

    // 终态不可改写
    const rejectedAfter = await command.execute(
      `reject ${draft.id}`,
      {} as never
    );
    expect(rejectedAfter.success).toBe(false);
  });

  it('无成功轨迹时如实报告（不伪造草案）', async () => {
    const { drafts, skills } = makeDirs();
    const command = createSopCommand({
      store: new SopDraftStore(drafts, skills),
      distill: () => [],
    });
    const result = await command.execute('distill', {} as never);
    expect(result.success).toBe(true);
    expect(result.message).toContain('未找到可蒸馏的成功轨迹');
  });
});
