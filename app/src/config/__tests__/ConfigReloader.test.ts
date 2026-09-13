/**
 * ConfigReloader 字段级对账测试（T2.3 / KPI #3 运行期观测）
 *
 * 真实链路（非 mock）：真实 ConfigWatcher 监听临时目录 + 真实文件写入，
 * 验证"值未变修改不触发 reload"，为 KPI #3（无效重载下降 ≥50%）提供运行期证据。
 *
 * 基线：配置修改 100% 触发重载 → 引入 diff 对账后，值未变修改应跳过（0 次无效重载）。
 */

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ConfigReloader,
  ConfigWatcher,
  stableSerialize,
} from '../ConfigReloader';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 轮询等待条件成立（超时 3s） */
async function waitFor(cond: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!cond() && Date.now() < deadline) {
    await sleep(50);
  }
  expect(cond()).toBe(true);
}

function makeTempConfig(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'config-reloader-'));
  const file = join(dir, 'config.json');
  // 初始内容：key 顺序 A
  writeFileSync(
    file,
    JSON.stringify({ channels: [{ id: 'a' }], enabled: true })
  );
  return { dir, file };
}

describe('ConfigReloader 字段级对账（T2.3 / KPI #3）', () => {
  test('stableSerialize 递归排序 key（key 顺序变化序列化结果相同）', () => {
    const a = stableSerialize({ channels: [{ id: 'a' }], enabled: true });
    const b = stableSerialize({ enabled: true, channels: [{ id: 'a' }] });
    expect(a).toBe(b);

    // 数组顺序变化 = 实质变化（不相等）
    const c = stableSerialize({ channels: [{ id: 'a' }, { id: 'b' }] });
    expect(c).not.toBe(
      stableSerialize({ channels: [{ id: 'b' }, { id: 'a' }] })
    );
  });

  test('值未变修改跳过 reload，值变化触发 reload（KPI #3 运行期观测）', async () => {
    const { dir, file } = makeTempConfig();
    let reloadCount = 0;
    const watcher = new ConfigWatcher(50); // 缩短 debounce 加速测试
    const reloader = new ConfigReloader(watcher);
    reloader.registerTarget({
      name: 'test-config',
      filePatterns: [/config\.json$/],
      reload: () => {
        reloadCount += 1;
      },
      priority: 0,
    });
    reloader.start([dir]);

    try {
      // 场景 1：首次变更 → 触发 reload（基线）
      writeFileSync(
        file,
        JSON.stringify({ channels: [{ id: 'a' }], enabled: true })
      );
      await waitFor(() => reloadCount === 1);
      expect(reloadCount).toBe(1);

      // 场景 2：值未变修改（key 顺序变化，语义相同）→ diff 跳过，不 reload
      writeFileSync(
        file,
        JSON.stringify({ enabled: true, channels: [{ id: 'a' }] })
      );
      await sleep(300); // 等 debounce + 对账完成
      expect(reloadCount).toBe(1); // 无新增无效重载

      // 场景 3：值变化（新增 channel）→ 触发 reload
      writeFileSync(
        file,
        JSON.stringify({ channels: [{ id: 'a' }, { id: 'b' }], enabled: true })
      );
      await waitFor(() => reloadCount === 2);
      expect(reloadCount).toBe(2);

      // KPI 核算：2 次修改（1 次值未变 + 1 次值变化），无效重载 0 次
      // 无效重载率 = 0/1 = 0%，相对基线 100% 下降 100%（≥50% ✅）
    } finally {
      reloader.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
