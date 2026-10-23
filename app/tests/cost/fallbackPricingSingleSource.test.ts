/**
 * 硬编码治理 **HD-P0-1**（2026-10-13）：**兜底价单一真源**
 *
 * 取证（治理方案 §4.1 **A2**）：兜底价 `{输入 3 / 输出 15 / 缓存读 0.3 / 缓存写 3.75}`（USD per 1M tokens）
 * 曾在 **3 处各自写一份数值**：
 *   ① `core/pricing.ts`（**真源**；债四 S1 由 `cost/ModelPricing.ts` 下沉而来，Q-U5）
 *   ② `tokenBudget/PriceManager.ts`（`DEFAULT_PRICING_RESULT`）—— 本轮收编
 *   ③ `ai/prompts/PromptCacheManager.ts`（`DEFAULT_CONFIG` 默认单价）—— 本轮收编
 * `cost/ModelPricing.ts` 已于 S1 改为**引用**真源（本测试同时钉住，防回退）。
 *
 * 风险：三处各自漂移 ⇒ 未知模型在「闸门折算 / 成本报表回落 / prompt-cache 估价」得到**不同单价**。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_MODEL_PRICING } from '@openliri/kernel/pricing';
import { PriceManager } from '../../src/tokenBudget/PriceManager';

const SRC = join(import.meta.dir, '..', '..', 'src');

function readSrc(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('HD-P0-1：兜底价单一真源（core `DEFAULT_MODEL_PRICING`）', () => {
  it('① 行为：未登记模型的回落价 == core 真源（四项逐字相等）', () => {
    const r = new PriceManager().getPriceSync('__hd_p0_1_unknown_model__');
    expect(r.pricing.inputPer1M).toBe(
      DEFAULT_MODEL_PRICING.inputPricePerMillion
    );
    expect(r.pricing.outputPer1M).toBe(
      DEFAULT_MODEL_PRICING.outputPricePerMillion
    );
    expect(r.pricing.cacheWritePer1M).toBe(
      DEFAULT_MODEL_PRICING.cacheCreationPricePerMillion
    );
    expect(r.pricing.cacheReadPer1M).toBe(
      DEFAULT_MODEL_PRICING.cacheReadPricePerMillion
    );
  });

  it('② 三处均引用真源（含 S1 已收编的 `cost/ModelPricing.ts`，防回退）', () => {
    for (const rel of [
      'tokenBudget/PriceManager.ts',
      'ai/prompts/PromptCacheManager.ts',
      'cost/ModelPricing.ts',
    ]) {
      expect(readSrc(rel), `${rel} 未引用 core 兜底价真源`).toContain(
        'DEFAULT_MODEL_PRICING'
      );
    }
  });

  it('③ 收编点不再各写一份数值（源码守卫：默认块内无旧字面量）', () => {
    const pm = readSrc('tokenBudget/PriceManager.ts');
    expect(pm).not.toMatch(/inputPer1M:\s*3\b/);
    expect(pm).not.toMatch(/outputPer1M:\s*15\b/);
    expect(pm).not.toMatch(/cacheWritePer1M:\s*3\.75/);
    expect(pm).not.toMatch(/cacheReadPer1M:\s*0\.3\b/);

    const pcm = readSrc('ai/prompts/PromptCacheManager.ts');
    expect(pcm).not.toMatch(/inputPricePer1M:\s*3(\.0)?\b/);
    expect(pcm).not.toMatch(/cacheWritePricePer1M:\s*3\.75/);
    expect(pcm).not.toMatch(/cacheReadPricePer1M:\s*0\.3\b/);
  });

  it('④ 真源字段名与结构未被改写（真源仍是 core 的 `ModelPricing` 形状）', () => {
    expect(DEFAULT_MODEL_PRICING.inputPricePerMillion).toBe(3);
    expect(DEFAULT_MODEL_PRICING.outputPricePerMillion).toBe(15);
    expect(DEFAULT_MODEL_PRICING.cacheReadPricePerMillion).toBe(0.3);
    expect(DEFAULT_MODEL_PRICING.cacheCreationPricePerMillion).toBe(3.75);
  });
});
