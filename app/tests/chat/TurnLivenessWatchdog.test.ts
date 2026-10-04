// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * TurnLivenessWatchdog 测试（2026-09-02，P3-3 对标 Hermes turn_liveness）
 *
 * 验证：无活动超时触发 onStall、touch 复位、stop 停止、配置解析兜底。
 */
import { describe, it, expect } from 'bun:test';
import {
  TurnLivenessWatchdog,
  resolveLivenessTimeout,
  resolveLivenessPoll,
  resolveStreamHeartbeatMs,
  DEFAULT_LIVENESS_TIMEOUT_MS,
  DEFAULT_LIVENESS_POLL_MS,
  DEFAULT_STREAM_HEARTBEAT_MS,
} from '../../src/chat/services/TurnLivenessWatchdog';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('TurnLivenessWatchdog', () => {
  it('无活动超过阈值时触发 onStall（带 sessionId 与 idleSeconds）', async () => {
    let fired: { sessionId?: string; idleSeconds: number } | null = null;
    const wd = new TurnLivenessWatchdog({
      timeoutMs: 100,
      pollMs: 20,
      onStall: (s) => {
        fired = { sessionId: s.sessionId, idleSeconds: s.idleSeconds };
      },
    });
    wd.start('s1');
    await sleep(200);
    wd.stop();
    expect(fired).not.toBeNull();
    expect(fired!.sessionId).toBe('s1');
    expect(typeof fired!.idleSeconds).toBe('number');
  });

  it('touch 复位空闲计时（有产出不误判）', async () => {
    // 2026-10-04 修 flaky：原写法 `timeoutMs:80` + `await sleep(50)` + 立即断言，
    // 依赖**绝对时点**——全量并行高负载下 sleep 漂移可越过 80ms，导致 touch 前就误触发
    // （实测偶发 fail）。改为**时点无关**：
    //   ① 阈值取远大于正常调度的量级（1500ms），持续 touch 保证任何合理延迟下都不误判；
    //   ② 触发用**有界等待**（不假定精确毫秒）。
    // 另注：`pollMs` 会被 `MIN_POLL_MS=100` 夹取；`check()` 对"采样跳变 > pollMs*3"（此处 900ms）
    // 视为事件循环阻塞并**重置空闲计时**，故 poll 取 300ms 以对负载停顿留足裕度。
    let fired: null | { idleSeconds: number } = null;
    const wd = new TurnLivenessWatchdog({
      timeoutMs: 1500,
      pollMs: 300,
      onStall: (s) => {
        fired = { idleSeconds: s.idleSeconds };
      },
    });
    wd.start('s2');
    // 持续产出：每次都在远小于阈值的间隔内复位 ⇒ 不应触发
    for (let i = 0; i < 5; i++) {
      await sleep(50);
      wd.touch();
    }
    expect(fired).toBeNull();

    // 停止产出 ⇒ 等到触发（有界等待，勿依赖精确时点）
    const deadline = Date.now() + 8000;
    while (fired === null && Date.now() < deadline) {
      await sleep(50);
    }
    wd.stop();
    expect(fired).not.toBeNull();
  });

  it('stop 后不再触发', async () => {
    let fired = false;
    const wd = new TurnLivenessWatchdog({
      timeoutMs: 50,
      pollMs: 20,
      onStall: () => {
        fired = true;
      },
    });
    wd.start();
    wd.stop();
    await sleep(120);
    expect(fired).toBe(false);
    expect(wd.isRunning()).toBe(false);
  });

  it('start 幂等（重复 start 不重置采样）', () => {
    const wd = new TurnLivenessWatchdog({ onStall: () => {} });
    wd.start();
    wd.start();
    expect(wd.isRunning()).toBe(true);
    wd.stop();
  });
});

describe('配置解析', () => {
  it('默认值', () => {
    expect(resolveLivenessTimeout({} as NodeJS.ProcessEnv)).toBe(
      DEFAULT_LIVENESS_TIMEOUT_MS
    );
    expect(resolveLivenessPoll({} as NodeJS.ProcessEnv)).toBe(
      DEFAULT_LIVENESS_POLL_MS
    );
  });

  it('环境变量生效', () => {
    expect(
      resolveLivenessTimeout({
        TURN_LIVENESS_TIMEOUT_MS: '120000',
      } as NodeJS.ProcessEnv)
    ).toBe(120000);
    expect(
      resolveLivenessPoll({
        TURN_LIVENESS_POLL_MS: '5000',
      } as NodeJS.ProcessEnv)
    ).toBe(5000);
  });

  it('非法值回退默认（绝不静默禁用）', () => {
    expect(
      resolveLivenessTimeout({
        TURN_LIVENESS_TIMEOUT_MS: '0',
      } as NodeJS.ProcessEnv)
    ).toBe(DEFAULT_LIVENESS_TIMEOUT_MS);
    expect(
      resolveLivenessTimeout({
        TURN_LIVENESS_TIMEOUT_MS: 'abc',
      } as NodeJS.ProcessEnv)
    ).toBe(DEFAULT_LIVENESS_TIMEOUT_MS);
    expect(
      resolveLivenessPoll({ TURN_LIVENESS_POLL_MS: '0' } as NodeJS.ProcessEnv)
    ).toBe(DEFAULT_LIVENESS_POLL_MS);
  });

  // T-⑥11：流式静默心跳间隔
  it('STREAM_HEARTBEAT_MS 默认 / 生效 / 非法回退', () => {
    expect(resolveStreamHeartbeatMs({} as NodeJS.ProcessEnv)).toBe(
      DEFAULT_STREAM_HEARTBEAT_MS
    );
    expect(
      resolveStreamHeartbeatMs({
        STREAM_HEARTBEAT_MS: '5000',
      } as NodeJS.ProcessEnv)
    ).toBe(5000);
    expect(
      resolveStreamHeartbeatMs({
        STREAM_HEARTBEAT_MS: '0',
      } as NodeJS.ProcessEnv)
    ).toBe(DEFAULT_STREAM_HEARTBEAT_MS);
    expect(
      resolveStreamHeartbeatMs({
        STREAM_HEARTBEAT_MS: 'abc',
      } as NodeJS.ProcessEnv)
    ).toBe(DEFAULT_STREAM_HEARTBEAT_MS);
  });
});
