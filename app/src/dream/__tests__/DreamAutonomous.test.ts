/**
 * D1-Step2：DreamPlanContract + DreamDenyRules 单元测试
 */
import { describe, test, expect } from 'bun:test';
import {
  parseDreamPlan,
  validateDreamPlan,
  buildDreamPlanMarkdown,
} from '../plan/DreamPlanContract';
import {
  isDeniedByAutonomousRules,
  isDeniedToolByAutonomousRules,
  checkAutonomousOperation,
} from '../execution/DreamDenyRules';

describe('DreamPlanContract', () => {
  test('合法计划可解析且校验通过', () => {
    const md = buildDreamPlanMarkdown({
      title: '整理本周会话知识',
      projectRoot: '/proj',
      summary: '对本周 12 个会话做知识凝练。',
      rationale: '周度维护。',
      proposedChange: '更新 knowledge 目录。',
      executionSteps: ['扫描会话', '生成摘要', '写入知识文件'],
      verification: '知识文件数增加。',
    });
    const plan = parseDreamPlan(md);
    expect(plan).not.toBeNull();
    expect(plan!.title).toBe('整理本周会话知识');
    expect(plan!.executionSteps).toHaveLength(3);
    const validation = validateDreamPlan(plan!);
    expect(validation.ok).toBe(true);
  });

  test('缺少必需节解析失败', () => {
    const md = `# 标题
> Dream Plan
> id: x
> projectRoot: /p
> createdAt: 1
> dedupeKey: k

## Summary
s
`;
    expect(parseDreamPlan(md)).toBeNull();
  });

  test('Proposed Change 含 TODO 校验失败', () => {
    const md = buildDreamPlanMarkdown({
      title: 't',
      projectRoot: '/p',
      summary: 's',
      rationale: 'r',
      proposedChange: '待补充 TODO',
      executionSteps: ['step1'],
      verification: 'v',
    });
    const plan = parseDreamPlan(md)!;
    const validation = validateDreamPlan(plan);
    expect(validation.ok).toBe(false);
    expect(validation.errors.join()).toContain('TODO');
  });

  test('元数据首行必须为 Dream Plan', () => {
    const md = `# 标题
> Not Dream Plan
> id: x
> projectRoot: /p
> createdAt: 1
> dedupeKey: k
`;
    expect(parseDreamPlan(md)).toBeNull();
  });
});

describe('DreamDenyRules', () => {
  test('git push 被拒绝', () => {
    expect(isDeniedByAutonomousRules('git push origin main')).toBe(true);
  });

  test('普通命令放行', () => {
    expect(isDeniedByAutonomousRules('git status')).toBe(false);
    expect(isDeniedByAutonomousRules('ls -la')).toBe(false);
  });

  test('rm -rf / 被拒绝', () => {
    expect(isDeniedByAutonomousRules('rm -rf / tmp')).toBe(true);
  });

  test('deny 工具被拒绝', () => {
    expect(isDeniedToolByAutonomousRules('cron')).toBe(true);
    expect(isDeniedToolByAutonomousRules('bash')).toBe(false);
  });

  test('统一入口', () => {
    expect(checkAutonomousOperation({ command: 'git push' }).allowed).toBe(
      false
    );
    expect(
      checkAutonomousOperation({ toolName: 'bash', command: 'ls' }).allowed
    ).toBe(true);
  });
});
