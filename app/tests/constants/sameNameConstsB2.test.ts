/**
 * 硬编码治理「同名常量」B2 守卫：协议/格式常量**唯一真源**（`CHANNEL_TAG` · `RESET`→`ANSI_RESET` · `BYTES_PER_TOKEN`）。
 *
 * 背景：这三组原为「同名常量在 ≥2 文件各写一份」——`lint:consts` 的 `同名常量:<NAME>` 检测项。
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
    expect(read('src/constants/xml.ts')).toMatch(/export const CHANNEL_TAG = 'channel';/);
    const parser = read('src/chat/ChannelMessageParser.ts');
    expect(parser).not.toMatch(/const CHANNEL_TAG =/);
    expect(parser).toContain("import { CHANNEL_TAG } from '@modules/constants';");
    expect(parser).toContain('export { CHANNEL_TAG };');
  });

  test('BYTES_PER_TOKEN 真源在 constants/toolLimits.ts；消费侧只保留导出面（不再定义）', () => {
    expect(read('src/constants/toolLimits.ts')).toMatch(/export const BYTES_PER_TOKEN = 4;/);
    const types = read('src/services/toolResultStorage/types.ts');
    expect(types).not.toMatch(/const BYTES_PER_TOKEN =/);
    expect(types).toContain("export { BYTES_PER_TOKEN } from '@modules/constants';");
  });
});
