/**
 * `@openliri/kernel` 桶契约冒烟。
 *
 * **为什么存在**：包内唯一的历史测试（`memory-host-sdk.test.ts`）随该模块一并删除后，
 * `packages/kernel` 会变成"零测试文件"——`bun test` 对零测试是 **exit 1**，
 * Kernel CI 的 Package tests 会因此假红（2026-10-24 实测）。
 * 本文件不测业务，只钉住**包本身就是可用内核**这条对外承诺：
 * 标识/版本常量存在，且桶确实导出了宿主开工所需的那几个符号。
 */

import { describe, expect, it } from 'bun:test';
import {
  AppError,
  KERNEL_PACKAGE_NAME,
  KERNEL_PACKAGE_VERSION,
  feature,
  globalEventBus,
  resolveDbPath,
} from './index.js';

describe('@openliri/kernel 桶契约（冒烟）', () => {
  it('包标识与版本常量存在且形如 semver', () => {
    expect(KERNEL_PACKAGE_NAME).toBe('@openliri/kernel');
    expect(KERNEL_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('桶导出宿主开工所需的关键符号', () => {
    // 变体开关（宿主注入）、路径解析、错误基类、事件总线 —— 缺任一项内核即不可用
    expect(typeof feature).toBe('function');
    expect(typeof resolveDbPath).toBe('function');
    expect(typeof AppError).toBe('function');
    expect(globalEventBus).toBeDefined();
  });
});
