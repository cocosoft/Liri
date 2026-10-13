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
 * 媒体侧车 **生命周期门控** 单测（S5/T5.1）。
 *
 * 锁定：
 * ① `TOOL_SIDECAR_MEDIA` 关（默认）⇒ **不 spawn**（零行为变更）；
 * ② 开关开 ⇒ 按 `sidecarIpc` 契约启动/握手/关闭（注入假子进程，不真 spawn）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import {
  isMediaSidecarEnabled,
  maybeStartMediaSidecar,
  stopMediaSidecar,
} from '../../../src/tools/sidecar/mediaSidecarLifecycle';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  encodeFrame,
} from '../../../src/utils/sidecarIpc';

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}
const asChild = (c: FakeChild): ChildProcess => c as unknown as ChildProcess;

const ENV_MEDIA = 'FEATURE_TOOL_SIDECAR_MEDIA';
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_MEDIA];
  delete process.env[ENV_MEDIA];
});
afterEach(() => {
  if (saved === undefined) delete process.env[ENV_MEDIA];
  else process.env[ENV_MEDIA] = saved;
  stopMediaSidecar();
});

describe('媒体侧车·生命周期门控', () => {
  it('开关关（默认）⇒ 不 spawn（零行为变更）', async () => {
    let spawnCalls = 0;
    const result = await maybeStartMediaSidecar({
      spawnFn: () => {
        spawnCalls += 1;
        return asChild(new FakeChild());
      },
    });
    expect(isMediaSidecarEnabled()).toBe(false);
    expect(result).toBeNull();
    expect(spawnCalls).toBe(0);
  });

  it('开关开 ⇒ 按契约启动/握手/关闭（注入假子进程）', async () => {
    process.env[ENV_MEDIA] = 'true';
    const fake = new FakeChild();
    const started = maybeStartMediaSidecar({ spawnFn: () => asChild(fake) });
    fake.stdout.write(
      encodeFrame({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
        pid: 7,
      }) + '\n'
    );
    const sup = await started;
    expect(isMediaSidecarEnabled()).toBe(true);
    expect(sup).not.toBeNull();
    expect(sup?.isRunning()).toBe(true);
    stopMediaSidecar();
    expect(fake.killed).toBe(true);
  });
});
