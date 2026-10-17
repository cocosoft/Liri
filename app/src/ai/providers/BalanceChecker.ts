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
 * - SiliconFlow: /v1/user/info（⚠️ 2026-08-14 被官方下线，暂无替代接口，见 querySiliconFlow）
 * - OpenRouter: GET /api/v1/credits
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('ai:providers:balanceChecker');

/**
 * **持续性告警的「只记一次」闸门**（2026-10-17 收敛噪音）。
 *
 * 为什么需要：余额查询按周期轮询（真机实测 ~10 分钟一轮），而「接口已官方下线」「固定错误码」
 * 这类**持续性**失败是**每轮都会命中**的 —— 旧实现每轮刷同一条 warning（同一 provider 的同一
 * 故障在 `app.log` 里每 10 分钟重复一条，无限增长且无新信息）。
 *
 * 语义：同一 `key` 首次 ⇒ `true`（调用方据此打印一次）；此后同 key ⇒ `false`（不打印）。
 * **恢复即清记忆**（`clearRecurringWarn(provider)`）⇒ 若日后恢复正常、之后再坏，仍会再记一次
 * （避免把「曾经坏过」永久静音而丢掉真实的**状态变化**）。
 *
 * `key` 约定：`${provider}|${kind}`（如 `siliconflow|retired`、`siliconflow|api-error:20092`）。
 *
 * ⚠️ 如实边界：闸门是**进程内**的（与仓内其它一次性标记同口径，如 `budgetReliefCard.sentSessions`）
 * ⇒ **进程重启后首个周期仍会记一条**（重启本身即状态重置）；它解决的是「同一运行期内每轮重复刷同一
 * 条告警」，不是「跨重启永久静音」（后者会掩盖真实的状态变化）。
 */
const recurringWarned = new Set<string>();

/** 见 {@link recurringWarned} 头注：本次**是否应当打印**（首次 ⇒ `true`；重复 ⇒ `false`） */
export function shouldWarnRecurring(key: string): boolean {
  if (recurringWarned.has(key)) return false;
  recurringWarned.add(key);
  return true;
}

/** 见 {@link recurringWarned} 头注：某 provider 恢复正常 ⇒ 清掉其记忆（键前缀 `provider|`，不会误伤 `siliconflow-en`） */
export function clearRecurringWarn(provider: string): void {
  const prefix = `${provider}|`;
  for (const k of [...recurringWarned]) {
    if (k.startsWith(prefix)) recurringWarned.delete(k);
  }
}

/** 仅供测试：清空闸门状态 */
export function resetRecurringWarnForTest(): void {
  recurringWarned.clear();
}

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
  | 'novita'
  | 'zhipu';

/** 检测供应商类型 */
function detectProvider(baseUrl: string): BalanceProvider | null {
  const url = baseUrl.toLowerCase();

  if (url.includes('api.deepseek.com')) return 'deepseek';
  if (url.includes('api.siliconflow.cn')) return 'siliconflow';
  if (url.includes('api.siliconflow.com')) return 'siliconflow-en';
  if (url.includes('openrouter.ai')) return 'openrouter';
  if (url.includes('api.novita.ai')) return 'novita';
  if (url.includes('open.bigmodel.cn')) return 'zhipu';
  if (url.includes('api.z.ai')) return 'zhipu';

  return null;
}

const BALANCE_CHECK_REQUEST_TIMEOUT_MS = 10000;

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
  const timeoutId = setTimeout(
    () => controller.abort(),
    BALANCE_CHECK_REQUEST_TIMEOUT_MS
  );

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

/** 从响应对象中尝试提取余额字段（支持多种命名风格） */
function extractBalanceFields(obj: Record<string, unknown>): {
  total: number | undefined;
  charge: number | undefined;
  free: number | undefined;
} {
  const pick = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = parseFloatField(obj, k);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  return {
    total: pick(
      'totalBalance',
      'total_balance',
      'totalBalance',
      'availableBalance',
      'available_balance'
    ),
    charge: pick(
      'chargeBalance',
      'charge_balance',
      'chargedBalance',
      'rechargeBalance'
    ),
    free: pick('balance', 'freeBalance', 'free_balance', '赠送余额'),
  };
}

/** SiliconFlow 余额查询
 * 原接口 GET https://api.siliconflow.cn/v1/user/info
 * ⚠️ 该接口已被官方下线（2026-08-14），返回 code=20092 "This endpoint is
 *    deprecated and is no longer available"，且官方暂未发布可用的替代接口
 *    （见 release-notes 2026.08.11《/user/info 接口将停止服务》）。
 *    因此余额查询在有替代接口前不可用，这里识别退役码并返回明确、诚实的错误，
 *    而不是把永久下线伪装成可重试的瞬时 API 错误。
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
    logger.info(
      `SiliconFlow 响应: status=${status} keys=${Object.keys(obj).join(',')}`
    );

    const apiCode = typeof obj['code'] === 'number' ? obj['code'] : undefined;
    const apiMessage = typeof obj['message'] === 'string' ? obj['message'] : '';

    // BUG-03：识别 /user/info 接口已官方下线（code=20092 或退役提示），
    // 返回明确的永久性错误，避免被误当作瞬时 API 错误反复重试/告警。
    const isRetired =
      apiCode === 20092 ||
      /deprecated|no longer available|停止服务|不再可用/i.test(apiMessage);
    if (isRetired) {
      // 持续性故障（接口已下线）⇒ **每个 provider 只记一次**（见 `shouldWarnRecurring` 头注）
      if (shouldWarnRecurring(`${provider}|retired`)) {
        logger.warning(
          `SiliconFlow 余额接口 /user/info 已被官方下线（code=${apiCode} msg=${apiMessage}），官方暂无替代接口，余额暂不可查（同状态后续不再重复告警）`
        );
      }
      return {
        success: false,
        provider,
        data: [],
        error:
          '硅基流动已下线余额查询接口 /user/info（官方 2026-08-14），官方暂未提供替代接口，余额暂不可查',
      };
    }

    // SiliconFlow 成功码: 20000 (文档) 或 0 / 200 (实际可能)
    if (
      apiCode !== undefined &&
      apiCode !== 20000 &&
      apiCode !== 0 &&
      apiCode !== 200
    ) {
      // 同类持续性错误码 ⇒ **只记一次**（见 `shouldWarnRecurring` 头注）
      if (shouldWarnRecurring(`${provider}|api-error:${apiCode}`)) {
        logger.warning(
          `SiliconFlow API 错误: code=${apiCode} msg=${apiMessage}（同类错误只记一次）`
        );
      }
      return {
        success: false,
        provider,
        data: [],
        error: `API 错误 (code=${apiCode}): ${apiMessage}`,
      };
    }

    // 尝试从 data 字段解析，若不存在则直接从根对象解析
    const dataField =
      obj['data'] && typeof obj['data'] === 'object'
        ? (obj['data'] as Record<string, unknown>)
        : obj;

    if (!dataField || typeof dataField !== 'object') {
      return { success: false, provider, data: [], error: '响应格式异常' };
    }

    const { total, charge, free } = extractBalanceFields(dataField);
    logger.info(
      `SiliconFlow 余额解析: total=${total} charge=${charge} free=${free}`
    );

    // 若所有字段均未提取到，记录原始字段供排查
    if (total === undefined && charge === undefined && free === undefined) {
      logger.warning(
        `SiliconFlow 未能提取余额字段，原始 data keys: ${Object.keys(dataField).join(',')}`
      );
    }

    const remaining = total ?? (free !== undefined ? free : undefined) ?? 0;

    const resultData: BalanceData[] = [
      {
        planName: 'SiliconFlow',
        remaining,
        total: total ?? remaining,
        unit: 'CNY',
      },
    ];

    if (charge !== undefined && charge > 0) {
      resultData.push({
        planName: 'SiliconFlow 充值余额',
        remaining: charge,
        unit: 'CNY',
      });
    }

    if (free !== undefined && free > 0) {
      resultData.push({
        planName: 'SiliconFlow 免费额度',
        remaining: free,
        unit: 'CNY',
      });
    }

    // 查询恢复正常 ⇒ 清掉本 provider 的告警记忆（下次再坏仍会记一次，见 `clearRecurringWarn`）
    clearRecurringWarn(provider);

    return {
      success: true,
      provider,
      data: resultData,
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

// ─── Zhipu AI (BigModel) ───────────────────────────────

/** 智谱 AI 余额查询
 *  GET https://open.bigmodel.cn/api/biz/account/query-customer-account-report
 *  返回: { balance: number }
 */
async function queryZhipu(apiKey: string): Promise<BalanceResult> {
  try {
    const { status, body } = await httpGet(
      'https://open.bigmodel.cn/api/biz/account/query-customer-account-report',
      apiKey
    );

    if (status === 401 || status === 403) {
      return {
        success: false,
        provider: 'zhipu',
        data: [],
        error: `认证失败 (HTTP ${status})`,
      };
    }

    if (!body || typeof body !== 'object') {
      return {
        success: false,
        provider: 'zhipu',
        data: [],
        error: '无效响应',
      };
    }

    const obj = body as Record<string, unknown>;
    const balance = parseFloatField(obj, 'balance');

    return {
      success: true,
      provider: 'zhipu',
      data: [
        {
          planName: '智谱 AI',
          remaining: balance,
          unit: 'CNY',
        },
      ],
    };
  } catch (error) {
    return {
      success: false,
      provider: 'zhipu',
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
      error: `不支持的供应商: ${baseUrl}。当前支持: DeepSeek, SiliconFlow, OpenRouter, Novita AI, 智谱 AI`,
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
    case 'zhipu':
      return queryZhipu(apiKey);
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
