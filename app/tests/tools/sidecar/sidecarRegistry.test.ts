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
 * 侧车进程登记表（基础设施专项 §6-#5 第二刀）。
 *
 * 口径：**只清"进程已不存在"的条目**（零风险）；"父已死、子仍活"只告警，
 * 因为 pid 可被复用 —— 自动清杀会误杀无关进程。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyRegistryEntries,
  createSidecarRegistry,
  readSidecarRegistry,
  scriptLabel,
  sweepStaleSidecarRegistryOnce,
  writeSidecarRegistry,
  type SidecarRegistryEntry,
} from '../../../src/tools/sidecar/sidecarRegistry';

const dir = mkdtempSync(join(tmpdir(), 'sidecar-registry-'));
let seq = 0;
const tmpFile = (): string => join(dir, `registry-${++seq}.json`);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const entry = (pid: number, parentPid: number): SidecarRegistryEntry => ({
  pid,
  parentPid,
  script: 'lspSidecar.ts',
  startedAt: 1_760_000_000_000,
});

describe('登记表对账（纯函数）', () => {
  it('父子都活 ⇒ live；父死子活 ⇒ stale（仍留在 live 里，等待人工处理）', () => {
    const alive = new Set([100, 200, 300]);
    const result = classifyRegistryEntries(
      [entry(100, 200), entry(300, 999), entry(400, 500)],
      (pid) => alive.has(pid)
    );
    expect(result.live.map((e) => e.pid)).toEqual([100, 300]);
    expect(result.stale.map((e) => e.pid)).toEqual([300]);
    expect(result.dead.map((e) => e.pid)).toEqual([400]);
  });

  it('子进程已不在 ⇒ dead（不论父是否还活）', () => {
    const result = classifyRegistryEntries([entry(7, 8)], () => false);
    expect(result.dead.map((e) => e.pid)).toEqual([7]);
    expect(result.stale).toEqual([]);
  });
});

describe('登记表读写', () => {
  it('往返一致；缺失文件 ⇒ 空表', () => {
    const path = tmpFile();
    expect(readSidecarRegistry(path)).toEqual([]);
    writeSidecarRegistry([entry(1, 2)], path);
    expect(readSidecarRegistry(path)).toEqual([entry(1, 2)]);
  });

  it('损坏的 JSON ⇒ 空表（登记表自己的最真实故障：写入途中断电）', () => {
    const path = tmpFile();
    writeFileSync(path, '{"version":1,"entries":[', 'utf8');
    expect(readSidecarRegistry(path)).toEqual([]);
  });

  it('端口：重复登记同一 pid ⇒ 只留一条（后写覆盖）；注销幂等', () => {
    const path = tmpFile();
    const port = createSidecarRegistry(path);
    port.register(entry(1, 2));
    port.register({ ...entry(1, 2), startedAt: 1_760_000_000_999 });
    expect(readSidecarRegistry(path)).toHaveLength(1);
    expect(readSidecarRegistry(path)[0]?.startedAt).toBe(1_760_000_000_999);

    port.unregister(1);
    expect(readSidecarRegistry(path)).toEqual([]);
    port.unregister(1); // 幂等：不抛错
    expect(readSidecarRegistry(path)).toEqual([]);
  });

  it('script 标签只取文件名（不含目录）', () => {
    expect(scriptLabel('/a/b/lspSidecar.ts')).toBe('lspSidecar.ts');
  });
});

describe('启动期对账（每路径只跑一次）', () => {
  it('全部健康 ⇒ 无孤儿、无清理；第二次调用不再重复处理', () => {
    const path = tmpFile();
    writeSidecarRegistry([entry(11, 21), entry(12, 22), entry(13, 23)], path);
    const alive = new Set([11, 12, 13, 21, 22, 23]); // 父子都在

    const stale = sweepStaleSidecarRegistryOnce({
      path,
      isAlive: (pid) => alive.has(pid),
    });
    expect(stale).toEqual([]);
    expect(readSidecarRegistry(path)).toHaveLength(3);

    // 同一路径只跑一次（即使这次"全都死了"也不处理）
    expect(
      sweepStaleSidecarRegistryOnce({ path, isAlive: () => false })
    ).toEqual([]);
    expect(readSidecarRegistry(path)).toHaveLength(3);
  });

  it('孤儿不清杀：父死子活 ⇒ 条目保留在表里并在返回值中上报', () => {
    const path = tmpFile();
    writeSidecarRegistry([entry(31, 41), entry(32, 42)], path);

    const stale = sweepStaleSidecarRegistryOnce({
      path,
      isAlive: (pid) => pid === 31 || pid === 32, // 两个子进程都还在，父进程都已退出
    });

    expect(stale.map((e) => e.pid)).toEqual([31, 32]);
    expect(readSidecarRegistry(path).map((e) => e.pid)).toEqual([31, 32]);
  });

  it('子进程已消失 ⇒ 从表里清掉（零风险清理）', () => {
    const path = tmpFile();
    writeSidecarRegistry([entry(51, 61), entry(52, 62)], path);

    const stale = sweepStaleSidecarRegistryOnce({
      path,
      isAlive: (pid) => pid === 61 || pid === 62, // 只剩父进程在，子进程都已退出
    });

    expect(stale).toEqual([]);
    expect(readSidecarRegistry(path)).toEqual([]);
  });
});
