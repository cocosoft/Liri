/**
 * SPI 装配守卫**覆盖性**测试（W26-16，2026-10-26）
 *
 * 背景：`core/spi/wiringGuard.ts` 的机制本身是对的（注册期断言、启动即失败、不静默降级），
 * 但此前只有 2 个端口在打标记 ⇒ 其余 15 个端口的装配顺序仍是**隐式契约**，守卫对它们形同未启用。
 *
 * 本测试做两件事（比"补表"更重要）：
 *  1. **覆盖率**：`spiWiring.ts` 里每个 `await register*Spi(...)` 都必须紧跟一个 `markSpiRegistered('...')`；
 *  2. **归属**：每个被标记的端口必须出现在 `SPI_WIRING_REQUIRES`（有顺序依赖）
 *     或下面的 `PORTS_WITHOUT_DEPENDENCIES`（显式声明"无依赖"）—— **二者其一，不得两边都有**。
 *
 * 于是「新增端口忘了登记」从可能变成不可能：不加归属 ⇒ 本测试红。
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { SPI_WIRING_REQUIRES } from '@openliri/kernel/spi';

const SPI_WIRING_SRC = readFileSync(
  new URL('../../src/entrypoints/spiWiring.ts', import.meta.url),
  'utf8'
);

/**
 * **显式声明「无装配顺序依赖」的端口**。
 *
 * 新增端口时：若它内部会调 `resolve*()` 取别的端口 ⇒ 进 `SPI_WIRING_REQUIRES`；
 * 否则加到这里。**别为了过测试随便加**。
 *
 * ⚠️ 如实说明（2026-10-26）：以下 16 项当前是「**尚未发现**顺序依赖」，不是「已证明无依赖」——
 * 逐个端口核对实现体里是否 `resolve*()` 别的端口，是 W26-16b 的收尾工作；
 * 本测试只保证「新端口必须显式归属」，不替你判断该归哪边。
 */
const PORTS_WITHOUT_DEPENDENCIES = [
  'logger',
  'otel',
  'startupProfiler',
  'broadcast',
  'agentTool',
  'pluginSystem',
  'aiAccess',
  'taskRegistry',
  'knowledgeGraph',
  'sessionQuality',
  'toolJobSuspend',
  'collaboration',
  'outboundGateway',
  'diagnosticsProbe',
  'sandbox',
  'hookChain',
] as const;

function matchAll(source: string, re: RegExp): string[] {
  return [...source.matchAll(re)].map((m) => m[1]);
}

/**
 * 去掉注释后的源码（**必须先脱注释再计数**）。
 *
 * 实证（负向对照，2026-10-26）：把 `markSpiRegistered('logger')` 注释掉后，纯文本正则仍会匹配到
 * 注释里的那串字符 ⇒ 断言假绿。故此处按行剥离 `//` 尾注释与整行注释后再匹配。
 */
const CODE_ONLY = SPI_WIRING_SRC.split('\n')
  .map((line) => line.replace(/\s\/\/.*$/, ''))
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');

const registerCalls = matchAll(CODE_ONLY, /await register([A-Z]\w*)Spi\(/g);
const markedPorts = matchAll(CODE_ONLY, /markSpiRegistered\('(\w+)'\)/g);

describe('SPI 装配守卫覆盖性（W26-16）', () => {
  it('`register*Spi` 实测 17 个（数量变化时需同步本测试与白名单）', () => {
    expect(registerCalls.length).toBe(17);
  });

  it('每个 register 调用都紧跟一个 markSpiRegistered（数量一致）', () => {
    expect(markedPorts.length).toBe(registerCalls.length);
  });

  it('标记的端口不重复（每个端口只声明一次）', () => {
    expect(new Set(markedPorts).size).toBe(markedPorts.length);
  });

  it('每个被标记的端口都有归属：SPI_WIRING_REQUIRES 或「无依赖白名单」', () => {
    const declared = new Set<string>([
      ...Object.keys(SPI_WIRING_REQUIRES),
      ...PORTS_WITHOUT_DEPENDENCIES,
    ]);
    const unowned = markedPorts.filter((port) => !declared.has(port));
    expect(unowned).toEqual([]);
  });

  it('两份清单互斥（同一端口不得既依赖别的端口、又声明"无依赖"）', () => {
    const overlap = Object.keys(SPI_WIRING_REQUIRES).filter((port) =>
      (PORTS_WITHOUT_DEPENDENCIES as readonly string[]).includes(port)
    );
    expect(overlap).toEqual([]);
  });

  it('「无依赖白名单」不含幽灵项（都已实际标记）', () => {
    const marked = new Set(markedPorts);
    const ghost = PORTS_WITHOUT_DEPENDENCIES.filter(
      (port) => !marked.has(port)
    );
    expect(ghost).toEqual([]);
  });

  it('`SPI_WIRING_REQUIRES` 的每个键都被实际标记（否则断言永不触发）', () => {
    const marked = new Set(markedPorts);
    const never = Object.keys(SPI_WIRING_REQUIRES).filter(
      (port) => !marked.has(port)
    );
    expect(never).toEqual([]);
  });
});
