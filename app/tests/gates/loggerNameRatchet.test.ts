/**
 * logger `module` 名棘轮 · 纯核心负向自证（2026-10-31，台账「logger 命名口径」项）
 *
 * 口径：新增/改动的 `getLogger('…')` 必须是 `域:子域` 结构；存量 PascalCase 历史名
 * 冻结进基线（不阻断、不批量改名 —— `module` 是运维检索维度）。
 *
 * 本文件**不跑全仓扫描**（保测试快），只锁三件事：
 *  ① 合规判定（含冒号、每段 `[A-Za-z0-9_-]`）；
 *  ② 抽取只认 `getLogger('…')` / `createLogger('…')` 的字面量（模板串 / 变量不收）；
 *  ③ 棘轮差分：新增 ⇒ 阻断；已报备 ⇒ 放行；消失 ⇒ 提示下调（不阻断）。
 */
import { describe, expect, it } from 'bun:test';

import {
  collectLoggerHits,
  diffBaseline,
  extractLoggerNames,
  isConformingLoggerName,
  toBaselineNames,
  type LoggerNameBaseline,
} from '../../../scripts/loggerNameRatchetCore.js';

describe('isConformingLoggerName：域:子域 结构', () => {
  it('合规：至少一个冒号，且每段仅 [A-Za-z0-9_-]', () => {
    for (const name of [
      'chat:manager',
      'tasks:longRunning',
      'runtime:api:CoreAPIImpl',
      'chat:yield:resumer',
      'mcp:server-1',
    ]) {
      expect(isConformingLoggerName(name)).toBe(true);
    }
  });

  it('不合规：无冒号的 PascalCase / 空段 / 非法字符 / 畸形', () => {
    for (const name of [
      'AIContextInjector',
      'CommandRegistry',
      'chat:',
      ':manager',
      'chat::manager',
      'chat:man ager',
      'chat:man.ager',
      '',
    ]) {
      expect(isConformingLoggerName(name)).toBe(false);
    }
  });
});

describe('extractLoggerNames：只收字符串字面量', () => {
  it('getLogger / createLogger 的单双引号字面量都收，且按文件内顺序去重', () => {
    const src = [
      "const a = getLogger('chat:manager');",
      'const b = createLogger("tasks:longRunning");',
      "const c = getLogger('chat:manager');",
      "const d = getLogger('LegacyName');",
    ].join('\n');
    expect(extractLoggerNames(src)).toEqual([
      'chat:manager',
      'tasks:longRunning',
      'LegacyName',
    ]);
  });

  it('负向：变量 / 模板串 / 其它函数 / 调用参数不误抽', () => {
    const src = [
      'const a = getLogger(MODULE_NAME);',
      'const b = getLogger(`dyn:${x}`);',
      "const c = notGetLogger('LegacyName');",
      "const d = fn('LegacyName');",
    ].join('\n');
    expect(extractLoggerNames(src)).toEqual([]);
  });
});

describe('collectLoggerHits + 棘轮差分', () => {
  const files = [
    { file: 'app/src/a.ts', text: "getLogger('LegacyA')" },
    { file: 'app/src/b.ts', text: "getLogger('chat:manager')" },
  ];

  it('只把**不合规**名计入命中（合规名无需报备）', () => {
    expect(collectLoggerHits(files)).toEqual([
      { name: 'LegacyA', file: 'app/src/a.ts' },
    ]);
  });

  it('已报备 ⇒ 放行；新增未报备 ⇒ 阻断；基线消失 ⇒ 提示下调（不阻断）', () => {
    const hits = collectLoggerHits(files);
    const baseline: LoggerNameBaseline = {
      version: 1,
      names: toBaselineNames(hits),
    };
    expect(diffBaseline(hits, baseline).newHits).toEqual([]);

    const grown = [...hits, { name: 'LegacyB', file: 'app/src/c.ts' }];
    expect(diffBaseline(grown, baseline).newHits).toEqual([
      { name: 'LegacyB', file: 'app/src/c.ts' },
    ]);

    const shrunk = hits.filter((h) => h.file !== 'app/src/a.ts');
    const d = diffBaseline(shrunk, baseline);
    expect(d.newHits).toEqual([]);
    expect(d.staleHits).toEqual([{ name: 'LegacyA', file: 'app/src/a.ts' }]);
  });

  it('同名不同文件各算一条（换了文件 = 新增未报备）', () => {
    const hits = collectLoggerHits(files);
    const baseline: LoggerNameBaseline = {
      version: 1,
      names: toBaselineNames(hits),
    };
    const moved = [{ name: 'LegacyA', file: 'app/src/moved.ts' }];
    expect(diffBaseline(moved, baseline).newHits).toEqual(moved);
  });
});
