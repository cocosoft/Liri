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
 * 探针：**未 unref 的定时器**定位（附带发现 7）
 *
 * 为什么不用 `process._getActiveHandles()` / `getActiveResourcesInfo()`：实测在本仓运行时的
 * Bun 下二者分别返回 `[]` / 空（**内省 API 不可信**）—— 而进程确实不退出。故改为**主动打桩**：
 * 在**导入 memory 之前**包装 `setTimeout` / `setInterval` / `clearXxx`，记录每个定时器的
 * **创建栈 + 是否被 unref + 是否被清除/已触发**；末尾报告**仍存活且未 unref** 的那些。
 *
 * 注意：ESM `import` 会被提升 ⇒ 必须先打桩、再用 `await import()` 动态导入被观测模块。
 *
 * 运行：`bun scripts/probe-memory-handles.ts`
 */
interface Rec {
  kind: 'interval' | 'timeout';
  ms: number;
  stack: string;
  unrefed: boolean;
  cleared: boolean;
  fired: boolean;
}

const recs = new Map<unknown, Rec>();

const origInterval = globalThis.setInterval.bind(globalThis);
const origTimeout = globalThis.setTimeout.bind(globalThis);
const origClearInterval = globalThis.clearInterval.bind(globalThis);
const origClearTimeout = globalThis.clearTimeout.bind(globalThis);

function attachTracker(t: unknown, r: Rec): void {
  recs.set(t, r);
  const anyT = t as { unref?: () => unknown };
  if (typeof anyT.unref === 'function') {
    const origUnref = anyT.unref.bind(t);
    anyT.unref = () => {
      r.unrefed = true;
      return origUnref();
    };
  }
}

(globalThis as unknown as { setInterval: unknown }).setInterval = (
  fn: (...a: unknown[]) => void,
  ms?: number,
  ...rest: unknown[]
): unknown => {
  const r: Rec = {
    kind: 'interval',
    ms: ms ?? 0,
    stack: new Error('setInterval@here').stack ?? '',
    unrefed: false,
    cleared: false,
    fired: false,
  };
  const wrapped = (...a: unknown[]): void => {
    r.fired = true;
    fn(...a);
  };
  const t = origInterval(wrapped as never, ms, ...rest);
  attachTracker(t, r);
  return t;
};

(globalThis as unknown as { setTimeout: unknown }).setTimeout = (
  fn: (...a: unknown[]) => void,
  ms?: number,
  ...rest: unknown[]
): unknown => {
  const r: Rec = {
    kind: 'timeout',
    ms: ms ?? 0,
    stack: new Error('setTimeout@here').stack ?? '',
    unrefed: false,
    cleared: false,
    fired: false,
  };
  const wrapped = (...a: unknown[]): void => {
    r.fired = true;
    fn(...a);
  };
  const t = origTimeout(wrapped as never, ms, ...rest);
  attachTracker(t, r);
  return t;
};

(globalThis as unknown as { clearInterval: unknown }).clearInterval = (
  t: unknown
): void => {
  const r = recs.get(t);
  if (r) r.cleared = true;
  origClearInterval(t as never);
};

(globalThis as unknown as { clearTimeout: unknown }).clearTimeout = (
  t: unknown
): void => {
  const r = recs.get(t);
  if (r) r.cleared = true;
  origClearTimeout(t as never);
};

function out(s: string): void {
  process.stdout.write(`${s}\n`);
}

async function main(): Promise<void> {
  // 打桩完成后才动态导入被观测模块（ESM import 提升会绕过打桩）。
  // 支持指定入口：`bun scripts/probe-memory-handles.ts ../src/chat/index.js`
  // 不传则默认观测 memory 模块（附带发现 7 的原始复现入口）。
  const target = process.argv[2] ?? '../src/memory/index.js';
  out(`[probe] 观测模块=${target}`);
  const mod = (await import(target)) as Record<string, unknown>;
  const ctor = mod.MemoryManagerImpl as
    | (new () => { getAllMemories: () => Promise<unknown[]> })
    | undefined;
  if (ctor) {
    const all = await ctor.prototype.getAllMemories
      ? await new ctor().getAllMemories()
      : [];
    out(`[probe] memories=${all.length} trackedTimers=${recs.size}`);
  } else {
    out(`[probe] 该模块无 MemoryManagerImpl，仅观测导入副作用 trackedTimers=${recs.size}`);
  }

  // 给"短命定时器"一点时间自行触发，避免把已完成的计时器误报为存活
  await new Promise<void>((r) => origTimeout(r, 1500));

  const alive: Rec[] = [];
  for (const r of recs.values()) {
    if (r.cleared) continue;
    if (r.kind === 'timeout' && r.fired) continue;
    alive.push(r);
  }

  out(`[probe] 仍存活定时器=${alive.length}（已排除 cleared 与已触发的 timeout）`);
  alive.forEach((r, i) => {
    out(
      `\n[timer ${i + 1}] ${r.kind} ms=${r.ms} unrefed=${r.unrefed} fired=${r.fired}\n${
        r.stack.split('\n').slice(0, 7).join('\n')
      }`
    );
  });

  out('\n[probe] main() 结束 —— 若进程不自动退出，即再现缺陷');
}

void main();
