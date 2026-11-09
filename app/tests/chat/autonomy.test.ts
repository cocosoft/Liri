// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话自主度契约测试（B1，2026-11-09）
 *
 * 关键断言：
 * - 非法取值必须被判为非法（HTTP 边界 fail loud 的前提）
 * - 请求体缺省 / 脏值**不得**覆盖已有会话值（未设置 === interactive，行为不变）
 * - 值相同不返回更新（不重复写库）
 */

import { describe, it, expect } from 'bun:test';
import {
  AUTONOMY_MODES,
  isAutonomyMode,
  isDemandSession,
  resolveRequestAutonomyUpdate,
} from '../../src/chat/autonomy';

describe('isAutonomyMode', () => {
  it('接受 interactive / demand', () => {
    expect(isAutonomyMode('interactive')).toBe(true);
    expect(isAutonomyMode('demand')).toBe(true);
  });

  it('拒绝其它取值（含大小写与空值）', () => {
    expect(isAutonomyMode('Demand')).toBe(false);
    expect(isAutonomyMode('INTERACTIVE')).toBe(false);
    expect(isAutonomyMode('')).toBe(false);
    expect(isAutonomyMode(undefined)).toBe(false);
    expect(isAutonomyMode(null)).toBe(false);
    expect(isAutonomyMode(1)).toBe(false);
  });

  it('白名单与类型同集合', () => {
    expect([...AUTONOMY_MODES]).toEqual(['interactive', 'demand']);
  });
});

describe('resolveRequestAutonomyUpdate', () => {
  it('请求缺失 / 脏值 ⇒ 不覆盖（undefined）', () => {
    expect(
      resolveRequestAutonomyUpdate({
        requestAutonomy: undefined,
        sessionAutonomy: 'demand',
      })
    ).toBeUndefined();
    expect(
      resolveRequestAutonomyUpdate({
        requestAutonomy: 'wish',
        sessionAutonomy: 'demand',
      })
    ).toBeUndefined();
  });

  it('缺省会话值按 interactive 处理：请求 interactive ⇒ 不写库', () => {
    expect(
      resolveRequestAutonomyUpdate({
        requestAutonomy: 'interactive',
        sessionAutonomy: undefined,
      })
    ).toBeUndefined();
  });

  it('值变化 ⇒ 返回新值（两个方向）', () => {
    expect(
      resolveRequestAutonomyUpdate({
        requestAutonomy: 'demand',
        sessionAutonomy: undefined,
      })
    ).toBe('demand');
    expect(
      resolveRequestAutonomyUpdate({
        requestAutonomy: 'interactive',
        sessionAutonomy: 'demand',
      })
    ).toBe('interactive');
  });

  it('值相同 ⇒ 不写库', () => {
    expect(
      resolveRequestAutonomyUpdate({
        requestAutonomy: 'demand',
        sessionAutonomy: 'demand',
      })
    ).toBeUndefined();
  });
});

describe('isDemandSession', () => {
  it('metadata.autonomy === demand ⇒ true', () => {
    expect(isDemandSession({ autonomy: 'demand' })).toBe(true);
  });

  it('缺省 / interactive / 脏值 / 非对象 ⇒ false（未设置 === interactive）', () => {
    expect(isDemandSession({})).toBe(false);
    expect(isDemandSession({ autonomy: 'interactive' })).toBe(false);
    expect(isDemandSession({ autonomy: 'wish' })).toBe(false);
    expect(isDemandSession({ autonomy: 'Demand' })).toBe(false);
    expect(isDemandSession(undefined)).toBe(false);
    expect(isDemandSession(null)).toBe(false);
    expect(isDemandSession('demand')).toBe(false);
  });
});
