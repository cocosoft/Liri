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

/**
 * UUID（8-4-4-4-12 十六进制）**形态判定**的单一真源（硬编码治理 B5-2㉛，2026-10-15 收敛）。
 *
 * 实测原为 **8 份副本**且取值逐字相同（同一事实 ⇒ 合一，非消歧）：
 * 2 处 `const UUID_RE =`（`ai/models/orphanModels.ts` · `infrastructure/http/handlers/chat-handlers.ts`）
 * + **6 处内联字面量**（`ai/modelRouter.ts` 的私有 `isUUID` · `session/key/LegacyKeyAdapter.ts`
 * · `tools/VideoGenerateTool` · `tools/ImageGenerateTool/{ImageGenerationTool,ImageGenerationRouter}`×3）
 * —— 内联形式对 `lint:consts` **不可见**（门禁只认 `const` 定义），故此前只报出 2 处。
 */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
