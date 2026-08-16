// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 官方价格源 — 同步逻辑
 *
 * 价格数据在 official-pricing-data.ts（OFFICIAL_PRICING），本文件负责：
 * 1. validateOfficialPricing()：进库前 schema 校验（时间格式/价格非负/枚举/必填）
 * 2. applyOfficialPricing()：幂等同步到 model_registry（仅更新已注册模型的价格字段，
 *    不新建模型；不覆盖 pricingSource=manual 的手工配置）
 *
 * 触发入口：POST /v1/models/pricing/sync；启动时非阻塞自动同步（main.ts T1.25.3）。
 */

import { getLogger } from '@modules/monitoring';
import {
  handleError,
  AppError,
  ErrorCategory,
  ErrorSeverity,
} from '@modules/error';
import { OFFICIAL_PRICING } from './official-pricing-data.js';
import type { OfficialProviderPricing } from './official-pricing-data.js';

const logger = getLogger('ai:pricing:official');

/** HH:mm 24h 格式 */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const BILLING_MODES = new Set([
  'token',
  'per_request',
  'token_and_per_request',
]);

function isNonNegative(v: number | undefined): boolean {
  return v === undefined || v >= 0;
}

/**
 * 校验官方价格表（进库前置校验）
 *
 * 任一模型有非法数据即返回对应错误；返回空数组表示全部合法。
 * 防止脏数据（坏时间格式、负价格、缺模型名等）流入 model_registry。
 */
export function validateOfficialPricing(
  data: OfficialProviderPricing[] = OFFICIAL_PRICING
): string[] {
  const errors: string[] = [];
  for (const provider of data) {
    const scope = provider.providerType || '<unknown-provider>';
    if (!provider.providerType) {
      errors.push(`[${scope}] providerType 不能为空`);
    }
    if (!provider.sourceUrl) {
      errors.push(`[${scope}] sourceUrl 不能为空`);
    }
    if (!provider.models || provider.models.length === 0) {
      errors.push(`[${scope}] models 不能为空`);
      continue;
    }
    for (const m of provider.models) {
      const tag = `[${scope}/${m.modelId || '<unknown-model>'}]`;
      if (!m.modelId) {
        errors.push(`${tag} modelId 不能为空`);
      }
      if (m.billingMode !== undefined && !BILLING_MODES.has(m.billingMode)) {
        errors.push(`${tag} billingMode 非法: ${m.billingMode}`);
      }
      if (!isNonNegative(m.inputPer1M)) {
        errors.push(`${tag} inputPer1M 不能为负: ${m.inputPer1M}`);
      }
      if (!isNonNegative(m.outputPer1M)) {
        errors.push(`${tag} outputPer1M 不能为负: ${m.outputPer1M}`);
      }
      if (!isNonNegative(m.cacheReadPer1M)) {
        errors.push(`${tag} cacheReadPer1M 不能为负: ${m.cacheReadPer1M}`);
      }
      if (!isNonNegative(m.cacheWritePer1M)) {
        errors.push(`${tag} cacheWritePer1M 不能为负: ${m.cacheWritePer1M}`);
      }
      if (!isNonNegative(m.pricePerRequest)) {
        errors.push(`${tag} pricePerRequest 不能为负: ${m.pricePerRequest}`);
      }
      // 至少一个计费依据：token 价或按次价
      if (
        m.inputPer1M === undefined &&
        m.outputPer1M === undefined &&
        m.pricePerRequest === undefined
      ) {
        errors.push(
          `${tag} 至少需要 inputPer1M/outputPer1M/pricePerRequest 之一`
        );
      }
      if (m.timeBasedPricing) {
        for (const slot of m.timeBasedPricing) {
          if (!HHMM_RE.test(slot.start) || !HHMM_RE.test(slot.end)) {
            errors.push(
              `${tag} 分时段时间格式非法: ${slot.start}-${slot.end}（应为 HH:mm）`
            );
          }
          if (slot.start === slot.end) {
            errors.push(`${tag} 分时段 start 不能等于 end: ${slot.start}`);
          }
          if (!isNonNegative(slot.inputCostPerMillion)) {
            errors.push(`${tag} 分时段 inputCostPerMillion 不能为负`);
          }
          if (!isNonNegative(slot.outputCostPerMillion)) {
            errors.push(`${tag} 分时段 outputCostPerMillion 不能为负`);
          }
          if (!isNonNegative(slot.cacheReadCostPerMillion)) {
            errors.push(`${tag} 分时段 cacheReadCostPerMillion 不能为负`);
          }
          if (!isNonNegative(slot.cacheWriteCostPerMillion)) {
            errors.push(`${tag} 分时段 cacheWriteCostPerMillion 不能为负`);
          }
        }
      }
    }
  }
  return errors;
}

/**
 * 将官方价格同步到 model_registry（幂等）
 * - 进库前先 validateOfficialPricing，有非法数据则抛错阻止同步（不写入任何脏数据）
 * - 仅更新已注册模型的价格字段（input/output/cacheRead/cacheWrite/billingMode/pricePerRequest/timeBasedPricing）
 * - 不新建模型、不删除模型；不覆盖 pricingSource=manual（用户手工配置）的模型
 * @returns 更新的模型数
 */
export async function applyOfficialPricing(): Promise<number> {
  try {
    const validationErrors = validateOfficialPricing();
    if (validationErrors.length > 0) {
      throw new AppError(
        `官方价格表校验失败，已阻止同步: ${validationErrors.join('; ')}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH
      );
    }

    const { modelPricingService } =
      await import('../models/ModelPricingService.js');
    await modelPricingService.initialize();

    let updated = 0;
    let changed = 0;
    let skippedUnregistered = 0;
    let skippedManual = 0;
    for (const provider of OFFICIAL_PRICING) {
      for (const m of provider.models) {
        const existing = await modelPricingService.getPricing(m.modelId);
        if (!existing) {
          skippedUnregistered++; // 模型未注册则跳过（不创建）
          continue;
        }
        if (existing.pricingSource === 'manual') {
          skippedManual++; // 不覆盖手工配置
          continue;
        }
        // 目标值 = 官方表值 ?? 现有值
        const target = {
          inputCostPerMillion: m.inputPer1M ?? existing.inputCostPerMillion,
          outputCostPerMillion: m.outputPer1M ?? existing.outputCostPerMillion,
          cacheReadCostPerMillion:
            m.cacheReadPer1M ?? existing.cacheReadCostPerMillion,
          cacheWriteCostPerMillion:
            m.cacheWritePer1M ?? existing.cacheWriteCostPerMillion,
          billingMode: m.billingMode ?? existing.billingMode,
          pricePerRequest: m.pricePerRequest ?? existing.pricePerRequest,
          timeBasedPricing: m.timeBasedPricing ?? existing.timeBasedPricing,
        };
        // 逐字段对比，记录价格变化明细
        const diffs: string[] = [];
        if (target.inputCostPerMillion !== existing.inputCostPerMillion) {
          diffs.push(
            `输入 ${existing.inputCostPerMillion}→${target.inputCostPerMillion}`
          );
        }
        if (target.outputCostPerMillion !== existing.outputCostPerMillion) {
          diffs.push(
            `输出 ${existing.outputCostPerMillion}→${target.outputCostPerMillion}`
          );
        }
        if (
          target.cacheReadCostPerMillion !== existing.cacheReadCostPerMillion
        ) {
          diffs.push(
            `缓存读 ${existing.cacheReadCostPerMillion}→${target.cacheReadCostPerMillion}`
          );
        }
        if (
          target.cacheWriteCostPerMillion !== existing.cacheWriteCostPerMillion
        ) {
          diffs.push(
            `缓存写 ${existing.cacheWriteCostPerMillion}→${target.cacheWriteCostPerMillion}`
          );
        }
        if (target.billingMode !== existing.billingMode) {
          diffs.push(`计费模式 ${existing.billingMode}→${target.billingMode}`);
        }
        if (target.pricePerRequest !== existing.pricePerRequest) {
          diffs.push(
            `按次价 ${existing.pricePerRequest}→${target.pricePerRequest}`
          );
        }
        if (
          JSON.stringify(target.timeBasedPricing ?? []) !==
          JSON.stringify(existing.timeBasedPricing ?? [])
        ) {
          diffs.push(
            `分时价差 ${JSON.stringify(existing.timeBasedPricing ?? [])}→${JSON.stringify(target.timeBasedPricing ?? [])}`
          );
        }

        await modelPricingService.upsertPricing({
          modelId: m.modelId,
          ...target,
          pricingSource: 'official',
        });
        updated++;
        if (diffs.length > 0) changed++;
        logger.info(
          `官方价格同步: ${m.modelId}${diffs.length > 0 ? ` — ${diffs.join(', ')}` : '（价格无变化）'}`
        );
      }
    }

    if (updated > 0) {
      const { ModelRegistry } = await import('../models/ModelRegistry.js');
      await ModelRegistry.getInstance().refreshDbPricing();
      logger.info(
        `官方价格已同步: ${updated} 个模型（${changed} 个有价格变化；跳过未注册 ${skippedUnregistered} / 手工配置 ${skippedManual}）`
      );
    }
    return updated;
  } catch (err) {
    if (err instanceof AppError) {
      // 校验失败：这是数据表 bug，必须暴露，不能静默吞掉
      await handleError(err, {
        module: 'ai:pricing:official',
        action: 'applyOfficialPricing',
      });
      return 0;
    }
    await handleError(err, {
      module: 'ai:pricing:official',
      action: 'applyOfficialPricing',
    });
    return 0;
  }
}
