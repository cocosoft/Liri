/**
 * P1-7 —— **SPI 装配顺序守卫**（`.trae/architecture/invariant-registry.json` `INV-ARCH-001`）。
 *
 * 此前"`AiAccess` 必须先于 `Knowledge`"**仅靠注释**声明 ⇒ 顺序错了会**晚失败/静默降级**。
 * 现由 `core/spi/wiringGuard.ts` 在**注册期**断言：乱序 ⇒ **立即抛错 + 可读原因**。
 *
 * ⚠️ 本文件**只在"乱序"分支调用真实 `registerKnowledgeSpi`** —— 该分支在**写入任何模块级状态前**
 * 即抛错（`requireSpiDependencies` 是第一步）⇒ 不留副作用；"正序"分支改用**纯守卫函数**断言，
 * 避免把假实现写进端口单例而污染同进程的其它测试。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import {
  SPI_WIRING_REQUIRES,
  isSpiRegistered,
  markSpiRegistered,
  requireSpiDependencies,
  resetSpiRegistryForTest,
} from '../../src/core/spi/wiringGuard.js';
import { registerKnowledgeSpi } from '../../src/core/spi/KnowledgeService.js';

/** DI 容器最小替身（仅需 `registerDescriptor`） */
const container = { registerDescriptor: () => {} } as never;
/** 端口实现替身（本测试只关心**装配顺序**，不调用端口方法） */
const impl = {} as never;

afterEach(() => resetSpiRegistryForTest());

describe('P1-7 SPI 装配顺序守卫', () => {
  it('顺序契约表登记了 knowledge → aiAccess（防被误删）', () => {
    expect(SPI_WIRING_REQUIRES.knowledge).toEqual(['aiAccess']);
  });

  it('【乱序】先装 Knowledge（AiAccess 未注册）⇒ 立即抛错，原因可读（含端口名）', async () => {
    resetSpiRegistryForTest();
    await expect(registerKnowledgeSpi(container, impl)).rejects.toThrow(
      /SPI 装配顺序/
    );
    // 再断言一次消息内容（可读性：明确"谁依赖谁"）
    await expect(registerKnowledgeSpi(container, impl)).rejects.toThrow(
      /'knowledge' 依赖 'aiAccess'/
    );
  });

  it('【正序】AiAccess 已注册 ⇒ 守卫放行（纯守卫断言，不写入端口单例）', () => {
    resetSpiRegistryForTest();
    markSpiRegistered('aiAccess');
    expect(isSpiRegistered('aiAccess')).toBe(true);
    expect(() => requireSpiDependencies('knowledge')).not.toThrow();
  });

  it('无依赖端口恒放行；`markSpiRegistered` 幂等', () => {
    resetSpiRegistryForTest();
    expect(() => requireSpiDependencies('someUnrelatedPort')).not.toThrow();
    markSpiRegistered('x');
    markSpiRegistered('x');
    expect(isSpiRegistered('x')).toBe(true);
  });
});
