/**
 * L3 write-back 门禁（§8.6-4，P5-2，2026-10-28）
 *
 * ## 背景（方案 §8.3 / §8.2 的「关键诊断」）
 * `EventBus`（进程内，L3）的 `historyEnabled` 默认 **false**、`maxHistorySize` 1000
 * ⇒ **没被订阅者接住的事件就消失**；真正的数据总线是 L1 `appendStreamEvent`（`events.jsonl`，
 * 可持久化 + 可回放）。方案要求的规则是：**可回放事件一律走 `appendStreamEvent`，EventBus 只传 id**。
 *
 * ## 本门禁的判据（实测口径，不靠约定）
 * 「可回放事件」的唯一事实源 = `shared/events/eventNames.ts` 的 `LIRI_EVENT_NAMES`（54 个）。
 * 因此违规形态被精确定义为：
 * > `app/src` 里出现 `.emit('<某个会话事件名>')` —— 即把**会话事件**发到进程内总线。
 *
 * 实测（2026-10-28）：`app/src` 共 **519** 处字符串 `.emit(...)`，与 54 个会话事件名
 * **零交集** ⇒ 现状合规（总线自带独立命名空间：`tool:completed` 这类信号，本就不是可回放事件）。
 * 本门禁把这个"零交集"钉死：将来谁新增 `eventBus.emit('assistant/text', …)` 就红。
 *
 * ## 已知限制（如实声明）
 * 只做**文本级**扫描：模板串 / 变量名（`.emit(name, …)`）不可判定 —— 但会话事件名是稳定字面量，
 * 且写入路径本就必须是 `appendStreamEvent(sessionId, { type: '…' })`，故漏报面可接受。
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { LIRI_EVENT_NAMES } from '../../../shared/events/eventNames';

const SRC_ROOT = resolve(import.meta.dir, '../../src');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))
      out.push(full);
  }
  return out;
}

/** 纯函数：从源码文本里找出"把会话事件名发到总线"的调用点 */
export function findBusEmitsOfSessionEvents(
  files: ReadonlyArray<{ file: string; text: string }>,
  sessionEventNames: ReadonlySet<string>
): string[] {
  const hits: string[] = [];
  for (const { file, text } of files) {
    for (const m of text.matchAll(/\.emit\(\s*['"]([^'"]+)['"]/g)) {
      const name = m[1]!;
      if (sessionEventNames.has(name)) hits.push(`${file} :: ${name}`);
    }
  }
  return hits.sort();
}

/** 纯函数：统计字符串字面量 `.emit(...)` 总数（防"扫描器恒空"的假绿） */
export function countStringEmits(
  files: ReadonlyArray<{ file: string; text: string }>
): number {
  let n = 0;
  for (const { text } of files) {
    for (const _ of text.matchAll(/\.emit\(\s*['"][^'"]+['"]/g)) n += 1;
  }
  return n;
}

const SESSION_EVENT_NAMES: ReadonlySet<string> = new Set<string>(
  LIRI_EVENT_NAMES as readonly string[]
);

const SOURCES = walkTs(SRC_ROOT).map((abs) => ({
  file: abs.slice(SRC_ROOT.length + 1).replace(/\\/g, '/'),
  text: readFileSync(abs, 'utf8'),
}));

describe('L3 write-back · 会话事件不得走进程内总线', () => {
  it('`app/src` 内没有把会话事件名发给 EventBus 的调用点', () => {
    // 防空转：扫描面与 emit 面都必须非空
    expect(SOURCES.length).toBeGreaterThan(500);
    expect(countStringEmits(SOURCES)).toBeGreaterThan(100);
    expect(SESSION_EVENT_NAMES.size).toBeGreaterThan(0);

    expect(findBusEmitsOfSessionEvents(SOURCES, SESSION_EVENT_NAMES)).toEqual(
      []
    );
  });

  it('门禁自证（负向夹具）：`.emit(会话事件名)` ⇒ 必报；普通总线信号不误报', () => {
    const fixture = [
      { file: 'a.ts', text: "bus.emit('tool:completed', { tool });" },
      { file: 'b.ts', text: "bus.emit('assistant/text', { text });" },
      { file: 'c.ts', text: 'bus.emit("tool/result", payload);' },
    ];
    expect(findBusEmitsOfSessionEvents(fixture, SESSION_EVENT_NAMES)).toEqual([
      'b.ts :: assistant/text',
      'c.ts :: tool/result',
    ]);
    expect(countStringEmits(fixture)).toBe(3);
  });

  it('口径自证：会话事件名与总线信号名**不共用命名空间**（前者含 `/`，后者用 `:`/`.`）', () => {
    // 若将来有人把 `turn/start` 这类名字直接当总线主题用，上面的用例就会红；
    // 本条只固定"两类名字形态不同"的事实，避免用 `/` 做无意义的总线主题。
    for (const name of SESSION_EVENT_NAMES) {
      expect(name).toContain('/');
    }
  });
});
