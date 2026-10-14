/**
 * 硬编码治理「同名常量」B2 守卫：协议/格式常量**唯一真源**（`CHANNEL_TAG` · `RESET`→`ANSI_RESET` · `BYTES_PER_TOKEN`）。
 *
 * 背景：这三组原为「同名常量在 ≥2 文件各写一份」——`lint:consts` 的 `同名常量:<NAME>` 检测项。
 * 2026-10-14 **续批 B2b**：再收 `A2A_TASKS_PATH`（原 `a2a-routes.ts` 与 `a2a/discoverySidecar.ts` 各一份）。
 * B2 的处置是**保留单一真源、其余处改为引用/转出**（导出面不变 ⇒ 零消费者改动、零行为变化）。
 *
 * 本测试即**防回流**：若有人再在消费侧写回 `const X =`，此处立即变红
 * （与棘轮门禁互补：门禁管"新增键 ⇒ 阻断"，本守卫管"这几处的形态不被改回"）。
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP = resolve(import.meta.dir, '../..');
const read = (rel: string) => readFileSync(join(APP, rel), 'utf8');

describe('同名常量 B2 · 协议/格式常量唯一真源', () => {
  test('ANSI_RESET 真源存在、取值钉住、并声明为唯一真源', () => {
    const src = read('src/constants/figures.ts');
    expect(src).toMatch(/export const ANSI_RESET = '\\x1b\[0m';/);
    expect(src).toContain('唯一真源');
  });

  test('两个原副本（cli/print.ts · commands/tasks/tasks.ts）不再各自定义 RESET，改为引用真源', () => {
    for (const rel of ['src/cli/print.ts', 'src/commands/tasks/tasks.ts']) {
      const src = read(rel);
      expect(src).not.toMatch(/const RESET =/);
      expect(src).toContain("from '@modules/constants'");
      expect(src).toContain('ANSI_RESET');
    }
    // 消费点确实用了新名（防"只改 import 未改用法"）
    expect(read('src/cli/print.ts')).toContain('result += ANSI_RESET;');
    expect(read('src/commands/tasks/tasks.ts')).toContain('${ANSI_RESET}');
  });

  test('CHANNEL_TAG 真源在 constants/xml.ts；消费侧只保留导出面（不再定义）', () => {
    expect(read('src/constants/xml.ts')).toMatch(
      /export const CHANNEL_TAG = 'channel';/
    );
    const parser = read('src/chat/ChannelMessageParser.ts');
    expect(parser).not.toMatch(/const CHANNEL_TAG =/);
    expect(parser).toContain(
      "import { CHANNEL_TAG } from '@modules/constants';"
    );
    expect(parser).toContain('export { CHANNEL_TAG };');
  });

  test('BYTES_PER_TOKEN 真源在 constants/toolLimits.ts；消费侧只保留导出面（不再定义）', () => {
    expect(read('src/constants/toolLimits.ts')).toMatch(
      /export const BYTES_PER_TOKEN = 4;/
    );
    const types = read('src/services/toolResultStorage/types.ts');
    expect(types).not.toMatch(/const BYTES_PER_TOKEN =/);
    expect(types).toContain(
      "export { BYTES_PER_TOKEN } from '@modules/constants';"
    );
  });

  test('B2b：A2A_TASKS_PATH 真源在 types/a2a.ts（与 A2A_RPC_PATH 同处）；两消费侧不再各自定义', () => {
    const truth = read('src/types/a2a.ts');
    expect(truth).toMatch(/export const A2A_TASKS_PATH = '\/v1\/a2a\/tasks';/);
    expect(truth).toContain('单一事实源');
    // 两消费侧：均不再定义本地副本，且都从真源模块导入
    const routes = read(
      'src/infrastructure/http/handlers/routes/a2a-routes.ts'
    );
    const sidecar = read('src/infrastructure/http/a2a/discoverySidecar.ts');
    for (const src of [routes, sidecar]) {
      expect(src).not.toMatch(/const TASKS_PATH =/);
      expect(src).toContain('A2A_TASKS_PATH');
    }
    expect(routes).toContain(
      "import { A2A_RPC_PATH, A2A_TASKS_PATH } from '@modules/types/a2a';"
    );
    expect(sidecar).toContain(
      "import { A2A_TASKS_PATH } from '@modules/types/a2a';"
    );
  });
});
