// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 供应商余额查询服务
 * 对标 CC 源码 cc-switch/src-tauri/src/services/balance.rs 实现
 *
 * 支持供应商：
 * - DeepSeek: GET /user/balance
 * - SiliconFlow: GET /v1/user/info
 * - OpenRouter: GET /api/v1/credits
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'ai:providers:balanceChecker',
  level: LogLevel.INFO,
});

/** 余额查询结果 */
export interface BalanceResult {
  success: boolean;
  provider: string;
  data: BalanceData[];
  error?: string;
}

/** 单条余额数据 */
export interface BalanceData {
  planName?: string;
  remaining?: number;
  total?: number;
  used?: number;
  unit?: string;
}

/** 支持的余额查询供应商 */
type BalanceProvider =
  | 'deepseek'
  | 'siliconflow'
  | 'siliconflow-en'
  | 'openrouter'
  | 'novita';

/** 检测供应商类型 */
function detectProvider(baseUrl: string): BalanceProvider | null {
  const url = baseUrl.toLowerCase();

  if (url.includes('api.deepseek.com')) return 'deepseek';
  if (url.includes('api.siliconflow.cn')) return 'siliconflow';
  if (url.includes('api.siliconflow.com')) return 'siliconflow-en';
  if (url.includes('openrouter.ai')) return 'openrouter';
  if (url.includes('api.novita.ai')) return 'novita';

  return null;
}

const REQUEST_TIMEOUT_MS = 10000;

/** 解析 JSON 数字字段 */
function parseFloatField(
  obj: Record<string, unknown>,
  field: string
): number | undefined {
  const val = obj[field];
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * 发起 HTTP GET 请求
 */
async function httpGet(
  url: string,
  apiKey: string
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let body: unknown = text;

    try {
      body = JSON.parse(text);
    } catch (err) {
      // 保持原始文本
    }

    return { status: response.status, body };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── DeepSeek ──────────────────────────────────────────

/** DeepSeek 余额 API
 *  GET https://api.deepseek.com/user/balance
 *  返回: { balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }], is_available }
 */
async function queryDeepSeek(apiKey: string): Promise<BalanceResult> {
  try {
    const { status, body } = await httpGet(
      'https://api.deepseek.com/user/balance',
      apiKey
    );

    if (status === 401 || status === 403) {
      return {
        success: false,
        provider: 'deepseek',
        data: [],
        error: `认证失败 (HTTP ${status})`,
      };
    }

    if (!body || typeof body !== 'object') {
      return {
        success: false,
        provider: 'deepseek',
        data: [],
        error: `无效响应`,
      };
    }

    const obj = body as Record<string, unknown>;
    const isAvailable = obj['is_available'] !== false;

    const infos = Array.isArray(obj['balance_infos'])
      ? obj['balance_infos']
      : [];

    const data: BalanceData[] = [];
    for (const info of infos) {
      if (typeof info !== 'object' || !info) continue;
      const item = info as Record<string, unknown>;
      const currency = (item['currency'] as string) || 'CNY';
      const total = parseFloatField(item, 'total_balance');

      data.push({
        planName: currency,
        remaining: total,
        unit: currency,
      });
    }

    return {
      success: true,
      provider: 'deepseek',
      data:
        data.length > 0
          ? data
          : [
              {
                planName: 'DeepSeek',
                unit: 'CNY',
                remaining: isAvailable ? undefined : 0,
              },
            ],
    };
  } catch (error) {
    return {
      success: false,
      provider: 'deepseek',
      data: [],
      error: `网络错误: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ─── SiliconFlow ───────────────────────────────────────

/** SiliconFlow 余额查询
 *  GET https://api.siliconflow.cn/v1/user/info
 *  返回: { code, data: { balance, chargeBalance, totalBalance, status } }
 */
async function querySiliconFlow(
  apiKey: string,
  isCn: boolean
): Promise<BalanceResult> {
  const domain = isCn ? 'api.siliconflow.cn' : 'api.siliconflow.com';
  const provider = isCn ? 'siliconflow' : 'siliconflow-en';

  try {
    const { status, body } = await httpGet(
      `https://${domain}/v1/user/info`,
      apiKey
    );

    if (status === 401 || status === 403) {
      return {
        success: false,
        provider,
        data: [],
        error: `认证失败 (HTTP ${status})`,
      };
    }

    if (!body || typeof body !== 'object') {
      return { success: false, provider, data: [], error: '无效响应' };
    }

    const obj = body as Record<string, unknown>;
    const dataField = obj['data'] as Record<string, unknown> | undefined;

    if (!dataField) {
      return { success: false, provider, data: [], error: '响应格式异常' };
    }

    const balance = parseFloatField(dataField, 'balance') || 0;
    const totalBalance = parseFloatField(dataField, 'totalBalance') || balance;

    return {
      success: true,
      provider,
      data: [
        {
          planName: 'SiliconFlow',
          remaining: balance,
          total: totalBalance,
          unit: 'CNY',
        },
      ],
    };
  } catch (error) {
    return {
      success: false,
      provider,
      data: [],
      error: `网络错误: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ─── OpenRouter ────────────────────────────────────────

/** OpenRouter 余额查询
 *  GET https://openrouter.ai/api/v1/credits
 *  返回: { data: { total_credits, total_usage } }
 */
async function queryOpenRouter(apiKey: string): Promise<BalanceResult> {
  try {
    const { status, body } = await httpGet(
      'https://openrouter.ai/api/v1/credits',
      apiKey
    );

    if (status === 401 || status === 403) {
      return {
        success: false,
        provider: 'openrouter',
        data: [],
        error: `认证失败 (HTTP ${status})`,
      };
    }

    if (!body || typeof body !== 'object') {
      return {
        success: false,
        provider: 'openrouter',
        data: [],
        error: '无效响应',
      };
    }

    const obj = body as Record<string, unknown>;
    const dataField = obj['data'] as Record<string, unknown> | undefined;

    if (!dataField) {
      return {
        success: false,
        provider: 'openrouter',
        data: [],
        error: '响应格式异常',
      };
    }

    const totalCredits = parseFloatField(dataField, 'total_credits') || 0;
    const totalUsage = parseFloatField(dataField, 'total_usage') || 0;

    return {
      success: true,
      provider: 'openrouter',
      data: [
        {
          planName: 'OpenRouter',
          remaining: totalCredits - totalUsage,
          total: totalCredits,
          used: totalUsage,
          unit: 'USD',
        },
      ],
    };
  } catch (error) {
    return {
      success: false,
      provider: 'openrouter',
      data: [],
      error: `网络错误: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ─── Novita AI ─────────────────────────────────────────

async function queryNovita(apiKey: string): Promise<BalanceResult> {
  try {
    const { status, body } = await httpGet(
      'https://api.novita.ai/v1/user/balance',
      apiKey
    );

    if (status === 401 || status === 403) {
      return {
        success: false,
        provider: 'novita',
        data: [],
        error: `认证失败 (HTTP ${status})`,
      };
    }

    if (!body || typeof body !== 'object') {
      return {
        success: false,
        provider: 'novita',
        data: [],
        error: '无效响应',
      };
    }

    const obj = body as Record<string, unknown>;
    const dataField = obj['data'] as Record<string, unknown> | undefined;

    return {
      success: true,
      provider: 'novita',
      data: [
        {
          planName: 'Novita AI',
          remaining: dataField
            ? parseFloatField(dataField, 'balance')
            : undefined,
          unit: 'USD',
        },
      ],
    };
  } catch (error) {
    return {
      success: false,
      provider: 'novita',
      data: [],
      error: `网络错误: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ─── 公共 API ─────────────────────────────────────────

/**
 * 查询供应商余额
 * @param baseUrl 供应商 API 基础 URL
 * @param apiKey API 密钥
 * @returns 余额查询结果
 */
export async function checkBalance(
  baseUrl: string,
  apiKey: string
): Promise<BalanceResult> {
  if (!apiKey) {
    return {
      success: false,
      provider: 'unknown',
      data: [],
      error: 'API Key 不能为空',
    };
  }

  const provider = detectProvider(baseUrl);

  if (!provider) {
    return {
      success: false,
      provider: 'unknown',
      data: [],
      error: `不支持的供应商: ${baseUrl}。当前支持: DeepSeek, SiliconFlow, OpenRouter, Novita AI`,
    };
  }

  logger.info(`查询余额: provider=${provider}`);

  switch (provider) {
    case 'deepseek':
      return queryDeepSeek(apiKey);
    case 'siliconflow':
    case 'siliconflow-en':
      return querySiliconFlow(apiKey, provider === 'siliconflow');
    case 'openrouter':
      return queryOpenRouter(apiKey);
    case 'novita':
      return queryNovita(apiKey);
  }
}

/**
 * 格式化余额查询结果为可读文本
 */
export function formatBalanceResult(result: BalanceResult): string {
  if (!result.success) {
    return `余额查询失败: ${result.error}`;
  }

  const lines = [`余额查询结果 — ${result.provider}`];

  for (const d of result.data) {
    const parts: string[] = [];

    if (d.planName) parts.push(d.planName);

    if (d.remaining !== undefined) {
      parts.push(
        `剩余: ${d.remaining.toFixed(2)}${d.unit ? ` ${d.unit}` : ''}`
      );
    }

    if (d.total !== undefined) {
      parts.push(`总额: ${d.total.toFixed(2)}${d.unit ? ` ${d.unit}` : ''}`);
    }

    if (d.used !== undefined) {
      parts.push(`已用: ${d.used.toFixed(2)}${d.unit ? ` ${d.unit}` : ''}`);
    }

    lines.push(`  ${parts.join(', ')}`);
  }

  return lines.join('\n');
}

export const BalanceChecker = {
  checkBalance,
  formatBalanceResult,
  detectProvider,
};
