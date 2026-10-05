/**
 * 事件类型三端一致性门禁（2026-09-29 建立，2026-09-30 升级为「shared 单一事实源」）
 *
 * 背景：`client/src/types/events.ts` 曾是后端 `app/src/session/types/events.ts` 的**手写镜像**，
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
// L2/L3（2026-10-05 P1-18）：载荷**字段级**跨端校验所需的**两端真实类型**
// （`import type` ⇒ 运行期擦除，`bun test` 不加载任何一端实现；仅供 `tsc` 做编译期断言）。
import type { LiriEventMap as AppEventMap } from '@modules/session/types/eventPayloads';
import type { LiriEventMap as ClientEventMap } from '../../../client/src/types/events';

const REPO_ROOT = join(import.meta.dir, '../../..');
/** 事件名单一事实源 */
const SHARED = join(REPO_ROOT, 'shared/events/eventNames.ts');
/** 后端载荷映射 */
const APP_PAYLOADS = join(REPO_ROOT, 'app/src/session/types/eventPayloads.ts');
/** 前端载荷映射（与事件名联合同文件） */
const CLIENT = join(REPO_ROOT, 'client/src/types/events.ts');

/** shared 数组项形态：`  'goal/created',` */
const ARRAY_ITEM = /^ {2}['"]([a-z][a-z0-9_/-]*)['"],$/;
/** 载荷映射顶层键形态：`  'goal/created': {` */
const MAP_KEY = /^ {2}['"]([a-z][a-z0-9_/-]*)['"]\s*:/;

// ────────────────────────────────────────────────────────────────────────────
// L2/L3（2026-10-05 P1-18）：载荷**字段级**跨端校验（**编译期**，`tsc` 可捕获）
//
// 上方运行期用例只比对**顶层键名**（事件名）。本块把校验下沉到**字段级**
// （字段名 / 类型 / 可选性），且**以两端真实类型为准**（直接引用两端 `LiriEventMap`），
// 不写任何手写期望表 ⇒ 零维护、随两端类型同步。
//
// 方向：**生产端（app）载荷必须可被消费端（client）声明的形状消费**
// （`AppEventMap[K] extends ClientEventMap[K]`）—— 这是运行时安全的**充要方向**
// （后端产出的 JSON 会被前端按 `LiriEventMap[K]` 读取）。
//   · 反向（client ⊆ app）**有意不**断言：`assistant/todo` 等事件前端会**本地产**
//     `action:'update'`（`stores/chat/streaming/EventBasedStreamAggregator.ts`），
//     与后端"仅产 write"（见 app 侧载荷注释）**有意**存在差异 ⇒ 强制反向会要求改前端
//     运行期行为，超出"跨端载荷校验"范围。
//   · **可选字段允许生产端多出**（向前兼容）：后端新增可选字段不影响前端消费。
//
// 落地：任一事件不满足 ⇒ `tsc --noEmit` 报错，并在错误信息中列出**问题事件名**。
// ────────────────────────────────────────────────────────────────────────────

/** 生产端独有的**必填**字段名（`undefined extends T[P]` ⇒ 该字段可选） */
type RequiredKeys<T> = {
  [P in keyof T]-?: undefined extends T[P] ? never : P;
}[keyof T];

/**
 * 逐事件比较：返回**不满足 `M[K] extends N[K]` 的事件名集合**（空集 = 通过）。
 *
 * ⚠️ 必须用**分配式条件类型**（裸类型参数 `K extends …`）而非映射类型 —— 实测映射类型
 * `{ [K in keyof M & keyof N]: … }` 在联合键上会退化为「联合级」判定（对 `assistant/status`
 * 的 `phase` 不兼容**漏报**），而分配式逐 `K` 具体求值可**精确**捕获（已用最小复现验证）。
 */
type MismatchKeys<
  M,
  N,
  K extends keyof M & keyof N = keyof M & keyof N,
> = K extends keyof M & keyof N ? (M[K] extends N[K] ? never : K) : never;

/** 逐事件：app 的**必填**字段名在 client 载荷中缺失的事件名集合 */
type MissingFieldKeys<
  M,
  N,
  K extends keyof M & keyof N = keyof M & keyof N,
> = K extends keyof M & keyof N
  ? Exclude<RequiredKeys<M[K]>, keyof N[K]> extends never
    ? never
    : K
  : never;

/** 断言为 `never`：断言值非 `never` ⇒ tsc 报错（即字段级校验失败，错误里列出问题事件名） */
type AssertNever<T extends never> = T;

/** 编译期断言①：app 载荷不可被 client 声明消费的事件集合必须为空 */
export type _PayloadTypeParity = AssertNever<
  MismatchKeys<AppEventMap, ClientEventMap>
>;
/** 编译期断言②：缺失必填字段名的事件集合必须为空 */
export type _PayloadFieldNameParity = AssertNever<
  MissingFieldKeys<AppEventMap, ClientEventMap>
>;

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
