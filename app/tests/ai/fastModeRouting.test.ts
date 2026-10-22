/**
 * Fast Mode 后端接线测试（2026-10-22）
 *
 * 接线前：`/fast` 只往全局 config 写 `fastMode`，而 `resolveFastModeState()` **无调用方**
 * ⇒ 开关"看起来生效"但模型路由不变。
 * 现在：`resolveSmartModel` 读取该开关，开启且用户未显式选模型 ⇒ 分流到
 * 「任务分工 → quick」的模型；quick 未配置 ⇒ 回落原路由链。
 *
 * 本用例锁两件事：
 *  - 状态解析：全局层接入后优先级链仍为 session → agent → global → model → default
 *  - 接线点：`llmChatOps.resolveSmartModel` 真的读开关并解析 `quick`
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { resolveFastModeState } from '../../src/agent/fast-mode';

const SRC = join(import.meta.dir, '..', '..', 'src');

describe('resolveFastModeState：全局层（globalConfig）', () => {
  it('未开启 ⇒ 默认档 disabled', () => {
    expect(resolveFastModeState({})).toEqual({
      enabled: false,
      source: 'default',
    });
    expect(resolveFastModeState({ globalConfig: null })).toEqual({
      enabled: false,
      source: 'default',
    });
  });

  it('全局开启/关闭都按 config 层生效（支持字符串形式）', () => {
    expect(resolveFastModeState({ globalConfig: true })).toEqual({
      enabled: true,
      source: 'config',
    });
    expect(resolveFastModeState({ globalConfig: false })).toEqual({
      enabled: false,
      source: 'config',
    });
    expect(resolveFastModeState({ globalConfig: 'true' })).toEqual({
      enabled: true,
      source: 'config',
    });
  });

  it('优先级：会话覆盖 > agent 默认 > 全局 > 模型级', () => {
    expect(
      resolveFastModeState({ sessionOverride: false, globalConfig: true })
    ).toEqual({ enabled: false, source: 'session' });

    expect(
      resolveFastModeState({ agentDefault: false, globalConfig: true })
    ).toEqual({ enabled: false, source: 'agent' });

    expect(
      resolveFastModeState({
        globalConfig: false,
        modelConfig: { provider: 'p', model: 'm', fastMode: true },
      })
    ).toEqual({ enabled: false, source: 'config' });
  });
});

describe('fast mode：接线点（源码断言）', () => {
  it('resolveSmartModel 读全局开关并解析 quick 任务模型', () => {
    const src = readFileSync(
      join(SRC, 'runtime', 'api', 'llmChatOps.ts'),
      'utf-8'
    );
    expect(src).toContain('resolveFastModeState');
    expect(src).toContain('globalConfig.fastMode');
    expect(src).toContain("resolve('quick')");
    expect(src).toContain("tier: 'fast-mode'");
  });

  it('用户显式选模型时优先，不被快速模式覆盖', () => {
    const src = readFileSync(
      join(SRC, 'runtime', 'api', 'llmChatOps.ts'),
      'utf-8'
    );
    const userSelected = src.indexOf("tier: 'user-selected'");
    const fastMode = src.indexOf('resolveFastModeState');
    expect(userSelected).toBeGreaterThan(-1);
    // 早返回必须排在快速模式之前
    expect(userSelected).toBeLessThan(fastMode);
  });
});
