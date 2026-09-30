/**
 * 事件类型三端一致性门禁（2026-09-29 建立，2026-09-30 升级为「shared 单一事实源」）
 *
 * 背景：`client/src/types/events.ts` 曾是后端 `app/src/chat/types/events.ts` 的**手写镜像**，
 * 文件头明文要求"双端必须保持一致"，但**此前无任何机制保证** ⇒ 2026-09-28 曾**实证**落后
 * 5 个类型（`goal/*` ×4 + `agent/recovery`，台账 D-1）。
 *
 * 2026-09-30（台账 D-57）：事件名**下沉到 `shared/events/eventNames.ts` 单一事实源**，
 * 两端 `LiriEventType` 均由其派生（`(typeof LIRI_EVENT_NAMES)[number]`）⇒「两端联合是否一致」
 * 已由**构造**保证，无需再比对联合本身。本门禁随之升级为**三端一致性**（shared 清单 vs
 * 两端**载荷映射**顶层键）：
 *   ① `LIRI_EVENT_NAMES` 的每个名字，两端载荷映射都必须有对应键；
 *   ② 两端载荷映射不得出现 `LIRI_EVENT_NAMES` 之外的名字（禁止单端自发增长）。
 *
 * 口径：只取**行首 2 空格缩进的顶层键 / 数组项**，避免误抓载荷内部的字符串值
 * （旧版正则 `[a-z_]+` 不含 `-`，会漏掉 `assistant/text-batch`、`context/model-input`
 * 这类含连字符的名字 —— 本次一并修正，覆盖面从 42 提升到全部 44）。
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(import.meta.dir, '../../..');
/** 事件名单一事实源 */
const SHARED = join(REPO_ROOT, 'shared/events/eventNames.ts');
/** 后端载荷映射 */
const APP_PAYLOADS = join(REPO_ROOT, 'app/src/chat/types/eventPayloads.ts');
/** 前端载荷映射（与事件名联合同文件） */
const CLIENT = join(REPO_ROOT, 'client/src/types/events.ts');

/** shared 数组项形态：`  'goal/created',` */
const ARRAY_ITEM = /^ {2}['"]([a-z][a-z0-9_/-]*)['"],$/;
/** 载荷映射顶层键形态：`  'goal/created': {` */
const MAP_KEY = /^ {2}['"]([a-z][a-z0-9_/-]*)['"]\s*:/;

function extract(filePath: string, pattern: RegExp): Set<string> {
  const names = new Set<string>();
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const m = pattern.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

/** 提取 shared 的事件名清单 */
export function extractSharedNames(): Set<string> {
  return extract(SHARED, ARRAY_ITEM);
}

describe('事件名三端一致性（shared 单一事实源 vs 两端载荷映射）', () => {
  const shared = extractSharedNames();
  const appPayloads = extract(APP_PAYLOADS, MAP_KEY);
  const clientPayloads = extract(CLIENT, MAP_KEY);

  test('三处都提取到足量事件名（防空跑假绿）', () => {
    expect(shared.size).toBeGreaterThan(30);
    expect(appPayloads.size).toBeGreaterThan(30);
    expect(clientPayloads.size).toBeGreaterThan(30);
  });

  test('shared 清单的每个事件名，两端载荷映射都必须有', () => {
    const missingApp = [...shared].filter((n) => !appPayloads.has(n)).sort();
    const missingClient = [...shared]
      .filter((n) => !clientPayloads.has(n))
      .sort();
    expect(missingApp, `后端载荷漏了：${missingApp.join(', ')}`).toEqual([]);
    expect(missingClient, `前端载荷漏了：${missingClient.join(', ')}`).toEqual(
      []
    );
  });

  test('两端载荷不得出现 shared 清单之外的事件名（禁止单端自发增长）', () => {
    const extraApp = [...appPayloads].filter((n) => !shared.has(n)).sort();
    const extraClient = [...clientPayloads]
      .filter((n) => !shared.has(n))
      .sort();
    expect(extraApp, `后端多出：${extraApp.join(', ')}`).toEqual([]);
    expect(extraClient, `前端多出：${extraClient.join(', ')}`).toEqual([]);
  });
});
