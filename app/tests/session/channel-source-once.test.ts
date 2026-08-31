/**
 * M4-T4.1 — 会话来源 set_once 判定契约
 *
 *   ① 请求带 channel 且会话无来源 → 返回 channel（待写入）
 *   ② 会话已有来源 → 返回 undefined（不覆盖）
 *   ③ 请求无 channel → 返回 undefined（本地/web 会话不动）
 *   ④ 空字符串 channel → 视为无效，返回 undefined
 */

import { describe, it, expect } from 'bun:test';
import { resolveChannelSourceOnce } from '../../src/chat/services/channelSourceOnce.js';

describe('resolveChannelSourceOnce（M4-T4.1）', () => {
  it('① 首次带 channel → 返回待写入来源', () => {
    expect(resolveChannelSourceOnce({ channel: 'telegram' }, undefined)).toBe(
      'telegram'
    );
    expect(resolveChannelSourceOnce({ channel: 'qq' }, undefined)).toBe('qq');
  });

  it('② 会话已有来源 → 不覆盖（set_once）；空串视为无来源可补写', () => {
    expect(resolveChannelSourceOnce({ channel: 'telegram' }, 'qq')).toBeUndefined();
    // 空字符串不是有效来源 → 视为无来源，允许补写
    expect(resolveChannelSourceOnce({ channel: 'telegram' }, '')).toBe('telegram');
  });

  it('③ 请求无 channel → 本地/web 会话不动', () => {
    expect(resolveChannelSourceOnce(undefined, undefined)).toBeUndefined();
    expect(resolveChannelSourceOnce({}, undefined)).toBeUndefined();
    expect(resolveChannelSourceOnce({ sender: 'u1' }, undefined)).toBeUndefined();
  });

  it('④ 非字符串 channel → 无效，不写入', () => {
    expect(resolveChannelSourceOnce({ channel: '' }, undefined)).toBeUndefined();
    expect(
      resolveChannelSourceOnce({ channel: 42 as unknown }, undefined)
    ).toBeUndefined();
  });
});
