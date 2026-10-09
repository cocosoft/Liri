/**
 * 统一 ID 熵源（C1，2026-10-09）
 *
 * 归属 **core**：`randomIdSuffix` 需被**所有层**使用（含 core 自身），而
 * `core → infra` 属分层倒挂（R00-001）⇒ 定义下沉至此，由 `utils/common` **再导出**
 * 以保持既有 `utils/common` 消费者零改动（单一实现，非第二份）。
 */
import { randomUUID } from 'crypto';

/**
 * crypto 强随机后缀（替代 `Math.random()` —— 后者非密码学安全）。
 *
 * @param length 截取长度（默认 8），返回 `[0-9a-f]` 字符串
 */
export function randomIdSuffix(length: number = 8): string {
  return randomUUID().replace(/-/g, '').slice(0, length);
}
