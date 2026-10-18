/**
 * 渠道投递类型（叶子模块）
 *
 * 2026-10-19（CI 循环依赖断环）：`DeliveryInteractiveCard` 原定义在 `DeliveryRouter.ts`，
 * 而 `deliveryFormatters.ts` 反向 `import type` 它 ⇒ 静态环。纯类型下沉后由
 * `DeliveryRouter.ts` 原样重导出，对外 API 不变。
 */

/** 交互卡片数据 */
export interface DeliveryInteractiveCard {
  title: string;
  color?: string;
  options?: Array<{ label: string; value: string }>;
}
