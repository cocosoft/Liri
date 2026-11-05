/**
 * DAEMON 模式的通道运行时接线（2026-11-05，P38 渠道样本取证）
 *
 * 现场：`startChannelRuntime` 的原始逻辑**只内联在 `launchREPL`** ⇒ daemon 模式
 * （桌面端/后台实际启动方式）通道从不注册、从不连接：
 * `GET /v1/channels/health` 恒为 `channels: []`、`channel_message_states` 长期 0 行、
 * P38 影子双跑因此永远没有渠道样本。
 *
 * 本用例锁两件事：
 *  ① REPL 与 DAEMON **调用同一实现**（单一来源，防再次分叉）；
 *  ② 该实现确实做「持久化 → 从 DB 恢复 → 后台连接」三步。
 *
 * 手法：源码扫描（同 `client/src/tests/navigationBoundary.test.ts` 的既有做法）。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', '..', 'src');

const mainSrc = readFileSync(join(SRC, 'main.ts'), 'utf8');
const runtimeSrc = readFileSync(
  join(SRC, 'entrypoints', 'channelRuntime.ts'),
  'utf8'
);

/** 取某个顶层 `async function <name>(…)` 的函数体（到下一个顶层 async function 为止） */
function functionBody(name: string): string {
  const start = mainSrc.indexOf(`async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = mainSrc.indexOf('\nasync function ', start + 1);
  return mainSrc.slice(start, next === -1 ? undefined : next);
}

describe('DAEMON 通道运行时接线', () => {
  it('launchDaemon 调用共用实现（此前完全缺失）', () => {
    expect(functionBody('launchDaemon')).toContain('startChannelRuntime');
  });

  it('launchREPL 同样调用共用实现（不再是内联副本）', () => {
    const body = functionBody('launchREPL');
    expect(body).toContain('startChannelRuntime');
    // 内联副本已移除：不得再直接依赖 setupChannels 的两个入口
    expect(body).not.toContain('lazyConnectChannels');
    expect(body).not.toContain('setupChannelsFromConfig');
  });

  it('共用实现包含「持久化 → DB 恢复 → 后台连接」三步', () => {
    expect(runtimeSrc).toContain('initPersistence()');
    expect(runtimeSrc).toContain('setupChannelsFromConfig()');
    expect(runtimeSrc).toContain('lazyConnectChannels()');
  });
});
