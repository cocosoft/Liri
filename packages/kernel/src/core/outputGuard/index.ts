// MIT License
// Copyright (c) 2026 190615273@qq.com

/** 输出侧护栏（统一契约）；见 `types.ts` 头注的边界与层归属说明
 *
 * P2（2026-10-28，v3 §6.1）：注册表实现（`registry`，含守卫排序与 fail-closed 聚合策略）
 * 已迁 `@modules/security/outputGuardRegistry`；内核只保留**契约**（`types.ts`），
 * 与「core 只放契约/机制、策略落 infra」的判据一致。
 */
export * from './types.js';
