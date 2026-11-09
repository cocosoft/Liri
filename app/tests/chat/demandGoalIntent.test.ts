// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B2（2026-11-09）：demand（许愿式）目标意图判定。
 *
 * 许愿式的典型写法**不含**「帮我/请/我要」等强动词（"做一个贪吃蛇小游戏"），
 * 因此 demand 模式改用排除法：只排除纯寒暄/致谢/确认与纯知识型提问。
 * 本测试锁定"排除法不是无条件放行"——寒暄与提问不得拉起编排。
 */

import { describe, expect, it } from 'bun:test';
import { isDemandGoalIntent } from '../../src/chat/taskIntent';

describe('isDemandGoalIntent — 目标（拉起编排）', () => {
  it('许愿式短句（无强动词）⇒ true', () => {
    expect(isDemandGoalIntent('做一个贪吃蛇小游戏')).toBe(true);
    expect(isDemandGoalIntent('给这个项目加一个登录页')).toBe(true);
    expect(isDemandGoalIntent('帮我写个脚本')).toBe(true);
    expect(isDemandGoalIntent('把导出的 CSV 按月份汇总')).toBe(true);
  });

  it('陈述式目标（"我想要…"）⇒ true', () => {
    expect(isDemandGoalIntent('我想要一个能打卡的小工具')).toBe(true);
  });

  it('"介绍一下…"不带问号 ⇒ 仍按目标（可能是要产出介绍文档）', () => {
    expect(isDemandGoalIntent('介绍一下这个项目')).toBe(true);
  });
});

describe('isDemandGoalIntent — 非目标（不拉起编排）', () => {
  it('纯寒暄 / 致谢 / 确认 ⇒ false', () => {
    expect(isDemandGoalIntent('你好')).toBe(false);
    expect(isDemandGoalIntent('您好！')).toBe(false);
    expect(isDemandGoalIntent('谢谢！')).toBe(false);
    expect(isDemandGoalIntent('好的')).toBe(false);
    expect(isDemandGoalIntent('ok')).toBe(false);
    expect(isDemandGoalIntent('嗯')).toBe(false);
    expect(isDemandGoalIntent('收到')).toBe(false);
    expect(isDemandGoalIntent('继续')).toBe(false);
  });

  it('纯知识型提问 ⇒ false', () => {
    expect(isDemandGoalIntent('什么是依赖注入？')).toBe(false);
    expect(isDemandGoalIntent('为什么天空是蓝色的?')).toBe(false);
    expect(isDemandGoalIntent('解释一下事件循环？')).toBe(false);
  });

  it('空串 / 空白 / 单字 ⇒ false', () => {
    expect(isDemandGoalIntent('')).toBe(false);
    expect(isDemandGoalIntent('   ')).toBe(false);
    expect(isDemandGoalIntent('？')).toBe(false);
  });
});
