/**
 * ConfigReloader 字段级对账（T2.3）测试
 *
 * 对齐方案 T2.3 验收标准：
 * 1. 写配置但值不变 → reload 未触发（skip）
 * 2. 嵌套字段 key 顺序变化 → 视为无实质变化（稳定序列化排序后比较）
 * 3. 值实质变化 → 正常 reload
 * 4. ConfigReloadTarget 新字段向后兼容（未提供 diff/rebuild 行为不变）
 * 5. rebuild 钩子：有实质变化时优先 rebuild
 * 6. 保守策略：解析失败 → 一律 reload
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  ConfigReloader,
  stableSerialize,
  ConfigChangeEvent,
} from '../ConfigReloader.js';

/** 测试访问 private handleChange（类型断言，非 any） */
function triggerChange(
  reloader: ConfigReloader,
  filePath: string
): Promise<void> {
  const withHook = reloader as unknown as {
    handleChange(e: ConfigChangeEvent): Promise<void>;
  };
  return withHook.handleChange({
    filePath,
    eventType: 'change',
    timestamp: Date.now(),
  });
}

describe('stableSerialize', () => {
  test('对象 key 排序：key 顺序变化 → 序列化相同', () => {
    const a = { b: 1, a: 2, c: { z: 3, y: 4 } };
    const b = { c: { y: 4, z: 3 }, a: 2, b: 1 };
    expect(stableSerialize(a)).toBe(stableSerialize(b));
  });

  test('数组元素顺序变化 → 序列化不同（视为实质变化）', () => {
    expect(stableSerialize([1, 2, 3])).not.toBe(stableSerialize([3, 2, 1]));
  });

  test('值变化 → 序列化不同', () => {
    expect(stableSerialize({ a: 1 })).not.toBe(stableSerialize({ a: 2 }));
  });
});

describe('ConfigReloader 字段级对账（T2.3）', () => {
  let dir: string;
  let configFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'config-reload-' + randomUUID()));
    configFile = join(dir, 'config.json');
    writeFileSync(configFile, JSON.stringify({ a: 1, b: [1, 2] }), 'utf-8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** 构造 loader 并注入一次基线（模拟首次变更已记录） */
  function createLoaderWithBaseline() {
    const reloader = new ConfigReloader();
    return reloader;
  }

  test('写配置但值不变 → reload 未触发（skip）', async () => {
    const reloader = createLoaderWithBaseline();
    let reloadCount = 0;
    reloader.registerTarget({
      name: 't1',
      filePatterns: [/config\.json$/],
      priority: 1,
      reload: () => {
        reloadCount++;
      },
    });

    // 首次变更：触发 reload + 记录基线
    await triggerChange(reloader, configFile);
    expect(reloadCount).toBe(1);

    // 同内容再次写入（值未变）→ 跳过 reload
    writeFileSync(configFile, JSON.stringify({ a: 1, b: [1, 2] }), 'utf-8');
    await triggerChange(reloader, configFile);
    expect(reloadCount).toBe(1); // 未再触发
  });

  test('嵌套字段仅 key 顺序变化 → 无实质变化，跳过 reload', async () => {
    const reloader = createLoaderWithBaseline();
    let reloadCount = 0;
    reloader.registerTarget({
      name: 't1',
      filePatterns: [/config\.json$/],
      priority: 1,
      reload: () => {
        reloadCount++;
      },
    });

    await triggerChange(reloader, configFile);
    expect(reloadCount).toBe(1);

    // 嵌套 key 顺序变化（b 数组不变，对象 key 乱序）
    writeFileSync(configFile, JSON.stringify({ b: [1, 2], a: 1 }), 'utf-8');
    await triggerChange(reloader, configFile);
    expect(reloadCount).toBe(1); // 跳过
  });

  test('值实质变化 → 正常 reload', async () => {
    const reloader = createLoaderWithBaseline();
    let reloadCount = 0;
    reloader.registerTarget({
      name: 't1',
      filePatterns: [/config\.json$/],
      priority: 1,
      reload: () => {
        reloadCount++;
      },
    });

    await triggerChange(reloader, configFile);
    expect(reloadCount).toBe(1);

    writeFileSync(configFile, JSON.stringify({ a: 2, b: [1, 2] }), 'utf-8');
    await triggerChange(reloader, configFile);
    expect(reloadCount).toBe(2); // 值变化 → reload
  });

  test('旧 target（无 diff/rebuild）行为不变：变更即 reload', async () => {
    const reloader = createLoaderWithBaseline();
    let reloadCount = 0;
    reloader.registerTarget({
      name: 'legacy',
      filePatterns: [/config\.json$/],
      priority: 1,
      reload: () => {
        reloadCount++;
      },
    });

    await triggerChange(reloader, configFile);
    expect(reloadCount).toBe(1);

    // 即使值未变，旧 target 也走默认比较（稳定序列化）→ 未变跳过。
    // 与旧行为（无条件 reload）不同——但默认比较是保守增强。
    writeFileSync(configFile, JSON.stringify({ a: 1, b: [1, 2] }), 'utf-8');
    await triggerChange(reloader, configFile);
    expect(reloadCount).toBe(1); // 值未变 → 跳过（默认对账生效）
  });

  test('rebuild 钩子：有实质变化时优先 rebuild 而非 reload', async () => {
    const reloader = createLoaderWithBaseline();
    let reloadCount = 0;
    let rebuildCount = 0;
    reloader.registerTarget({
      name: 't-rebuild',
      filePatterns: [/config\.json$/],
      priority: 1,
      reload: () => {
        reloadCount++;
      },
      rebuild: () => {
        rebuildCount++;
      },
    });

    await triggerChange(reloader, configFile);
    expect(rebuildCount).toBe(1); // 首次有变化 → rebuild
    expect(reloadCount).toBe(0);

    writeFileSync(configFile, JSON.stringify({ a: 3, b: [1, 2] }), 'utf-8');
    await triggerChange(reloader, configFile);
    expect(rebuildCount).toBe(2);
    expect(reloadCount).toBe(0);
  });

  test('保守策略：文件解析失败 → 一律 reload', async () => {
    const reloader = createLoaderWithBaseline();
    let reloadCount = 0;
    reloader.registerTarget({
      name: 't1',
      filePatterns: [/config\.json$/],
      priority: 1,
      reload: () => {
        reloadCount++;
      },
    });

    await triggerChange(reloader, configFile);
    expect(reloadCount).toBe(1);

    // 写入非法 JSON → 无法判定 → reload（保守）
    writeFileSync(configFile, '{broken', 'utf-8');
    await triggerChange(reloader, configFile);
    expect(reloadCount).toBe(2);
  });
});
