// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D3（M5）：需求追踪 ID 测试
 * RequirementTracker：注册去重 + 覆盖检查（证据映射）；
 * ImplicitEngineHook.persist：goal/requirement 上下文注册 + artifact 打标集成。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RequirementTracker } from '../../src/project/RequirementTracker';
import { ImplicitEngineHook } from '../../src/project/ImplicitEngineHook';

const root = join(tmpdir(), `req-tracker-test-${Date.now()}`);
const projectId = 'p-req-test';
const projectDir = join(root, projectId);
mkdirSync(projectDir, { recursive: true });

afterAll(() => {
  try {
    rmSync(root, { force: true, recursive: true });
  } catch {
    /* 清理失败不阻断 */
  }
});

describe('RequirementTracker — 需求注册（D3）', () => {
  it('注册 goal/requirement 上下文并生成确定性 requirementId', () => {
    const tracker = new RequirementTracker(projectId, root);
    const req = tracker.register({
      type: 'goal',
      content: '开发一个电商结算模块',
      sessionId: 's-1',
    });
    expect(req.id).toMatch(/^req_[0-9a-f]{12}$/);

    // 同内容去重：返回同一 id
    const again = tracker.register({
      type: 'goal',
      content: '开发一个电商结算模块',
      sessionId: 's-1',
    });
    expect(again.id).toBe(req.id);

    // 不同内容 → 不同 id
    const other = tracker.register({
      type: 'requirement',
      content: '结算支持微信支付',
      sessionId: 's-1',
    });
    expect(other.id).not.toBe(req.id);

    expect(tracker.list().length).toBe(2);
  });

  it('覆盖检查：requirementId 标签 + 内容片段双重证据映射', () => {
    const tracker = new RequirementTracker(projectId, root);
    const req = tracker.register({
      type: 'goal',
      content: '电商结算模块需要支持多种支付方式',
    });

    // 构造 artifacts：一个打标签，一个内容匹配
    writeFileSync(
      join(projectDir, 'artifacts.json'),
      JSON.stringify([
        {
          id: 'a-1',
          projectId,
          kind: 'output',
          title: '结算模块设计文档',
          content: '支付网关接入说明',
          createdAt: new Date().toISOString(),
          requirementId: req.id,
        },
        {
          id: 'a-2',
          projectId,
          kind: 'output',
          title: '测试报告',
          content: '多种支付方式集成测试用例',
          createdAt: new Date().toISOString(),
        },
      ]),
      'utf-8'
    );

    const coverage = tracker.checkCoverage();
    const entry = coverage.find((c) => c.requirement.id === req.id);
    expect(entry).toBeDefined();
    expect(entry!.covered).toBe(true);
    expect(entry!.evidence.length).toBeGreaterThanOrEqual(1);
    expect(entry!.evidence).toContain('结算模块设计文档');
  });
});

describe('ImplicitEngineHook.persist — 需求注册集成（D3）', () => {
  it('检测到 goal 上下文时注册需求并给产物打标', async () => {
    const text =
      '项目目标：开发发票识别工具\n需求：支持 pdf 与图片两种输入\n产出：E:\\out\\invoice.pdf';
    const result = await ImplicitEngineHook.persist(
      projectId,
      text,
      root,
      's-int'
    );

    expect(result.registeredRequirements).toBeGreaterThanOrEqual(1);
    expect(result.hasGoal).toBe(true);
    expect(result.deliverables).toBeGreaterThanOrEqual(1);

    // requirements.json 落盘 + artifacts 打标
    const tracker = new RequirementTracker(projectId, root);
    const reqs = tracker.list();
    expect(reqs.length).toBeGreaterThanOrEqual(3); // 含前面用例注册的 2 条 + 本次 2 条（goal/requirement）

    const artifacts = JSON.parse(
      readFileSync(join(projectDir, 'artifacts.json'), 'utf-8')
    ) as Array<{ title: string; requirementId?: string }>;
    expect(artifacts.some((a) => a.requirementId)).toBe(true);
  });
});
