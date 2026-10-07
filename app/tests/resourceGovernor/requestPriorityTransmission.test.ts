// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * P26-1 §9.1 请求优先级**透传**守卫（2026-10-07，spec `cross-session-resource-governor.md` §9.1）
 *
 * 背景（实测 2026-10-07）：`StreamMessageOptions.priority` 与治理器 `admit({priority})` 早已就位
 * （阶段 1），但**生产入口从未透传** ⇒ `snapshot()` 中恒为 `interactive`（"优先级生产侧恒 interactive"）。
 * 本批把 `priority` 从 HTTP body（`ChatCompletionRequest.priority`）经 `ChatRequest.priority` →
 * `chatStream` options 透传到 `StreamMessageOptions`；渠道入站（`messageRouter`）显式传 `background`。
 *
 * 本守卫锁两件事：
 *   ① **边界收窄**：`parseRequestPriority` 只放行 `REQUEST_PRIORITIES` 白名单，非法/缺省 ⇒ `undefined`
 *      （**不报错、不猜测** —— 保持"此前无该字段"的旧行为）；
 *   ② **透传可观测**：透传后的值在治理器 `snapshot()` 中**可区分** `interactive` / `background`。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import {
  DEFAULT_REQUEST_PRIORITY,
  REQUEST_PRIORITIES,
  parseRequestPriority,
} from '../../src/types/requestPriority';
import { ResourceGovernor } from '../../src/resourceGovernor/index';

const ENV = 'FEATURE_RESOURCE_GOVERNOR';
const ORIGINAL = process.env[ENV];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[ENV];
  else process.env[ENV] = ORIGINAL;
});

describe('parseRequestPriority：系统边界白名单收窄', () => {
  it('白名单成员原样返回', () => {
    for (const p of REQUEST_PRIORITIES) {
      expect(parseRequestPriority(p)).toBe(p);
    }
  });

  it('非法 / 缺省 / 非字符串 ⇒ undefined（不报错、不猜测）', () => {
    expect(parseRequestPriority('urgent')).toBeUndefined();
    expect(parseRequestPriority('')).toBeUndefined();
    expect(parseRequestPriority(undefined)).toBeUndefined();
    expect(parseRequestPriority(null)).toBeUndefined();
    expect(parseRequestPriority(1)).toBeUndefined();
    expect(parseRequestPriority({})).toBeUndefined();
    // CS02：结构化枚举，不做大小写/模糊匹配
    expect(parseRequestPriority('Interactive')).toBeUndefined();
  });

  it('缺省回落常量为 interactive（本次未改动）', () => {
    expect(DEFAULT_REQUEST_PRIORITY).toBe('interactive');
  });
});

describe('透传后治理器可区分 interactive / background（开关开启）', () => {
  it('admit 记录透传值，snapshot 按 startedAt 可见两者差异', () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor();

    gov.admit({
      sessionId: 'channel-inbound',
      priority: parseRequestPriority('background') ?? DEFAULT_REQUEST_PRIORITY,
    });
    gov.admit({
      sessionId: 'user-ui',
      priority: parseRequestPriority(undefined) ?? DEFAULT_REQUEST_PRIORITY,
    });

    expect(gov.snapshot().map((e) => `${e.sessionId}:${e.priority}`)).toEqual([
      'channel-inbound:background',
      'user-ui:interactive',
    ]);
  });
});
