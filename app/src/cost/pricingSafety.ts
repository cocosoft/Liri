// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 定价安全函数
 *
 * 防止异常数据（负值/NaN/Infinity/异常大值）导致成本虚高或虚低。
 * 参考 codeburn-main `src/models.ts` 的 safePerTokenRate / safe 实现。
 */

// 2026-09-30 下沉 core（A1 分层倒挂收口）：下沉后的 `calculateCost` 需要这两个安全函数，
// 故随之下沉 `app/src/core/pricing.ts`；此处**原样转出**，导出名与签名逐字不变
// （`app/tests/cost/calculate.test.ts` 直接引用本文件 ⇒ 测试零改动）。
export { safeTokens, safePerTokenRate } from '../core/pricing.js';

/**
 * 安全模型名：剥离控制字符，截断过长的名称
 * 参考 codeburn: model.replace(/[\x00-\x1F\x7F-\x9F]/g, '?').slice(0, 200)
 */
export function safeModelName(name: string): string {
  if (!name || typeof name !== 'string') return '<unknown>';
  return name.replace(/[\x00-\x1F\x7F-\x9F]/g, '?').slice(0, 200);
}
