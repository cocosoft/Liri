// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 官方价格源数据表 — 各供应商官方刊例价（含分时价差 / 按次计价）
 *
 * 数据与同步逻辑分离：本文件只维护价格数据，校验/同步逻辑在
 * official-pricing.ts（applyOfficialPricing 进库前必须先过 validateOfficialPricing）。
 *
 * 来源：厂商官方定价页（价格可能变动，核对 updatedAt 后更新）。
 * 币种：统一 USD（CNY 换算按 1 USD ≈ 7.2 CNY，见条目标注）。
 */

import type {
  BillingMode,
  TimeBasedPrice,
} from '../models/ModelPricingService.js';

export interface OfficialModelPrice {
  modelId: string;
  /** 每百万 token 输入价（USD） */
  inputPer1M?: number;
  /** 每百万 token 输出价（USD） */
  outputPer1M?: number;
  /** 缓存命中输入价（USD/百万） */
  cacheReadPer1M?: number;
  /** 缓存写入价（USD/百万） */
  cacheWritePer1M?: number;
  /** 计费模式（默认 token） */
  billingMode?: BillingMode;
  /** 按次计价单价（USD/请求） */
  pricePerRequest?: number;
  /** 分时价差（命中时段覆盖默认价） */
  timeBasedPricing?: TimeBasedPrice[];
}

export interface OfficialProviderPricing {
  providerType: string;
  sourceUrl: string;
  updatedAt: string;
  models: OfficialModelPrice[];
}

/**
 * 官方价格表
 *
 * ── DeepSeek（2026-08-17 生效，来源 https://api-docs.deepseek.com/zh-cn/quick_start/pricing）──
 * 高峰时段 = 北京时间 09:00-12:00、14:00-18:00；闲时 = 高峰价 50%。
 * 官方刊例价（CNY/百万）：V4-Flash 闲时输入 1.5 / 输出 4.5 / 缓存命中 0.05，高峰输入 3.0 / 输出 9.0 / 缓存命中 0.10；
 *                   V4-Pro  闲时输入 4.5 / 输出 13.5 / 缓存命中 0.15，高峰输入 9.0 / 输出 27.0 / 缓存命中 0.30。
 *
 * ── OpenAI（2026-05-21 核实，来源 https://openai.com/api/pricing）──
 * gpt-4o 输入 2.5 / 输出 10 / 缓存命中 1.25；gpt-4o-mini 输入 0.15 / 输出 0.6 / 缓存命中 0.075。
 *
 * ── Google（2026-08-12 核实，来源 https://ai.google.dev/gemini-api/docs/pricing）──
 * gemini-2.5-pro 输入 1.25 / 输出 10 / 缓存命中 0.125（≤200k，>200k 输入翻倍）；
 * gemini-2.5-flash 输入 0.3 / 输出 2.5 / 缓存命中 0.03。
 *
 * ── Qwen（阿里云百炼，来源 https://www.aliyun.com/product/bailian/pricing）──
 * 官方刊例价（CNY/百万）：qwen-turbo 输入 0.3 / 输出 0.6；qwen-plus 输入 0.8 / 输出 2；qwen-max 输入 20 / 输出 60。
 */
export const OFFICIAL_PRICING: OfficialProviderPricing[] = [
  {
    providerType: 'deepseek',
    sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
    updatedAt: '2026-08-17',
    models: [
      {
        modelId: 'deepseek-v4-flash',
        inputPer1M: 0.208, // 闲时 ¥1.5
        outputPer1M: 0.625, // 闲时 ¥4.5
        cacheReadPer1M: 0.007, // 闲时 ¥0.05
        timeBasedPricing: [
          {
            start: '09:00',
            end: '12:00',
            inputCostPerMillion: 0.417,
            outputCostPerMillion: 1.25,
            cacheReadCostPerMillion: 0.014,
          },
          {
            start: '14:00',
            end: '18:00',
            inputCostPerMillion: 0.417,
            outputCostPerMillion: 1.25,
            cacheReadCostPerMillion: 0.014,
          },
        ],
      },
      {
        modelId: 'deepseek-v4-pro',
        inputPer1M: 0.625, // 闲时 ¥4.5
        outputPer1M: 1.875, // 闲时 ¥13.5
        cacheReadPer1M: 0.021, // 闲时 ¥0.15
        timeBasedPricing: [
          {
            start: '09:00',
            end: '12:00',
            inputCostPerMillion: 1.25,
            outputCostPerMillion: 3.75,
            cacheReadCostPerMillion: 0.042,
          },
          {
            start: '14:00',
            end: '18:00',
            inputCostPerMillion: 1.25,
            outputCostPerMillion: 3.75,
            cacheReadCostPerMillion: 0.042,
          },
        ],
      },
    ],
  },
  {
    providerType: 'openai',
    sourceUrl: 'https://openai.com/api/pricing/',
    updatedAt: '2026-05-21',
    models: [
      {
        modelId: 'gpt-4o',
        inputPer1M: 2.5,
        outputPer1M: 10,
        cacheReadPer1M: 1.25,
      },
      {
        modelId: 'gpt-4o-mini',
        inputPer1M: 0.15,
        outputPer1M: 0.6,
        cacheReadPer1M: 0.075,
      },
    ],
  },
  {
    providerType: 'google',
    sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    updatedAt: '2026-08-12',
    models: [
      {
        modelId: 'gemini-2.5-pro',
        inputPer1M: 1.25,
        outputPer1M: 10,
        cacheReadPer1M: 0.125,
      },
      {
        modelId: 'gemini-2.5-flash',
        inputPer1M: 0.3,
        outputPer1M: 2.5,
        cacheReadPer1M: 0.03,
      },
    ],
  },
  {
    providerType: 'dashscope',
    sourceUrl: 'https://www.aliyun.com/product/bailian/pricing',
    updatedAt: '2026-08-16',
    models: [
      {
        modelId: 'qwen-turbo',
        inputPer1M: 0.042, // ¥0.3/百万
        outputPer1M: 0.083, // ¥0.6/百万
      },
      {
        modelId: 'qwen-plus',
        inputPer1M: 0.111, // ¥0.8/百万
        outputPer1M: 0.278, // ¥2/百万
      },
      {
        modelId: 'qwen-max',
        inputPer1M: 2.778, // ¥20/百万
        outputPer1M: 8.333, // ¥60/百万
      },
    ],
  },
];
