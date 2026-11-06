// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// P2-2（2026-11-06）回归锁：PDCA 计划源 / 项目目标摘要。
//
// 真机 `session_mw458fpp3ea32a050e`：用户末条只是「按计划直接执行 / 全部执行 P0-P6」，
// 原实现 `userMessage || description` 把助手已产出的完整计划整段丢弃 ⇒ 计划 description
// 变成三句用户原话，step1「定位并读取现有执行计划」5 秒即 blocked。

import { describe, expect, it } from 'bun:test';
import {
  buildPdcaPlanSource,
  buildProjectGoalSummary,
} from '../../src/chat/launchers/planSource';

const PLAN =
  '## 俄罗斯方块开发 · 执行计划\n\nS1 初始化目录\nS2 core/pieces.ts\nS3 core/board.ts';

describe('buildPdcaPlanSource：短指令必须并入助手计划正文', () => {
  it('用户是短指令 + 助手有计划 ⇒ 两者都进分解源（修复前只剩用户三句）', () => {
    const source = buildPdcaPlanSource('按计划直接执行', PLAN);
    expect(source).toContain('按计划直接执行');
    expect(source).toContain('【此前已产出并确认的执行计划');
    expect(source).toContain('core/pieces.ts');
  });

  it('用户消息本身就是长任务描述（>120 字）⇒ 原样使用（零行为变更）', () => {
    const longUser = '请完成一个很长的任务描述'.repeat(20);
    expect(buildPdcaPlanSource(longUser, PLAN)).toBe(longUser);
  });

  it('边界：任一侧为空 / 都为空', () => {
    expect(buildPdcaPlanSource('', PLAN)).toContain('core/pieces.ts');
    expect(buildPdcaPlanSource('按计划执行', '')).toBe('按计划执行');
    expect(buildPdcaPlanSource(undefined, undefined)).toBe('');
  });

  it('助手计划过长 ⇒ 截断并标注（不把上下文吃满）', () => {
    const huge = 'x'.repeat(9000);
    const source = buildPdcaPlanSource('继续', huge);
    expect(source).toContain('计划正文过长，已截断');
    expect(source.length).toBeLessThan(9000);
  });
});

describe('buildProjectGoalSummary：短指令时取助手计划标题', () => {
  it('短指令 + 助手标题 ⇒ 用标题当项目名（修复前三句拼接）', () => {
    expect(buildProjectGoalSummary('按计划直接执行', PLAN)).toBe(
      '俄罗斯方块开发 · 执行计划'
    );
  });

  it('用户消息够长 ⇒ 按用户消息截断（既有语义不变）', () => {
    const user = '把俄罗斯方块小游戏完整开发出来并出具报告';
    expect(buildProjectGoalSummary(user, PLAN)).toBe(user.slice(0, 30));
  });

  it('短指令且助手无标题 ⇒ 回退用户消息', () => {
    expect(buildProjectGoalSummary('继续', '没有标题的正文')).toBe('继续');
  });
});
