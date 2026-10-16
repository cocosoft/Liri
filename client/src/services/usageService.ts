/**
 * 统一用量服务层
 * 合并原 usageService / costService / pricingService / balanceService
 * 全部指向 /v1/usage/* 统一前缀
 */

import { httpLegacy as http } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import { getOTelTracing } from "../monitoring/otel";
import type {
  UsageSummary,
  DailyUsageStats,
  ModelUsageStats,
  ProviderUsageStats,
  BalanceResult,
  BalanceRecord,
} from "../types";

// ─── 类型定义 (原 costService / pricingService) ──────────────────

export interface CostRecord {
  id: string;
  date: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cost: number;
  currency: string;
}

export interface ProviderBreakdown {
  provider: string;
  /** 供应商名称（后端按 model_registry.provider_id → providers.name 解析） */
  providerName?: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requests: number;
  avgLatencyMs: number;
  percentage: number;
}

export interface DailyBreakdown {
  date: string;
  cost: number;
  tokens: number;
}

export interface CostSummary {
  totalSessions: number;
  todayCost: number;
  weeklyCost: number;
  monthlyCost: number;
  yearlyCost: number;
  todayTokens: number;
  monthlyTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalRequests: number;
  successRate: number;
  sessionCost: number;
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionTokens: number;
  topProviders: ProviderBreakdown[];
  dailyBreakdown: DailyBreakdown[];
}

export interface CostRecordsResponse {
  records: CostRecord[];
  total: number;
}

/** 对账结果（GET /v1/usage/cost/reconcile） */
export interface CostReconcileResult {
  matched: number;
  onlyInUsage: number;
  onlyInCost: number;
  costDiffs: Array<{
    requestId: string;
    model: string;
    costUsageLogs: number;
    costRecords: number;
    diff: number;
  }>;
  total: number;
  matchRate: string;
}

export interface ModelPricingRecord {
  id: string;
  modelId: string;
  displayName: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cacheReadCostPerMillion: number;
  cacheWriteCostPerMillion: number;
  costMultiplier: number;
  pricingSource: string;
  isCustom: boolean;
}

/** 日 Token 限额档位（对齐后端 `DailyBudgetManager` 三级模式） */
export type DailyBudgetMode = "normal" | "report_only" | "locked";

/** 放行种类（D-b：临时提额 / 单次豁免 / 当日解除） */
export type DailyBudgetReliefKind = "boost" | "waive-once" | "unlock-today";

/** 当前生效的放行（对齐后端 `ReliefView`） */
export interface DailyBudgetReliefView {
  kind: DailyBudgetReliefKind;
  /** 到期时刻（epoch ms）；`null` = 至**日界**（`unlock-today`） */
  expiresAt: number | null;
  /** 当前**有效**上限（放行生效时为提高后的上限） */
  effectiveLimit: number;
}

/** 放行请求体（与后端 `ReliefInput` 结构等价；`boost` 二选一给 `factor` / `amount`） */
export interface DailyBudgetReliefInput {
  kind: DailyBudgetReliefKind;
  factor?: number;
  amount?: number;
  ttlMs?: number;
  /**
   * **可选：唤醒收窄目标**（2026-10-17 用户裁定，spec D5 增补）。
   *
   * 只把本次放行的**唤醒范围**收窄到该会话 —— 额度仍是**当日全局**（日预算是共享资源，
   * 无法按会话提额）。会话级入口（挂起卡片）必须带上，否则会连带唤醒当日其它挂起会话
   * （它们会自行开跑并花钱）；「用量中心 → 日限额」保持缺省（全局口径）。
   */
  sessionId?: string;
}

/**
 * 日预算**主口径**单位（债四 D1/S3，2026-10-15 落地；对齐后端 `BudgetUnit`）。
 *
 * - `"usd"`：USD 闸门启用 ⇒ **金额是唯一硬闸门**；`used`/`dailyLimit`/`percentUsed`/`remaining`
 *   均为**金额**，`todayUsed` 降为辅助（Token 观测）。
 * - `"tokens"`：USD 闸门未启用 ⇒ **回落** Token 口径。
 */
export type DailyBudgetUnit = "tokens" | "usd";

/**
 * **预算挂起**条目（`GET /v1/cost/daily-budget/suspend`，Spec `long-task-suspend-resume.md` v1.5 A2）。
 *
 * 语义：会话在**轮间安全点**被封存（检查点已落盘）并登记，等用户**放行**后由协调器**自动续跑**
 * —— 即"撞限 ≠ 丢上下文"。（本清单**不受** `FEATURE_BUDGET_SUSPEND_RESUME` 门控：开关关时恒空。）
 */
export interface BudgetSuspendEntry {
  sessionId: string;
  /** 链：`stream`（桌面聊天主路径）/ `taor`（batch） */
  chain: string;
  /** 挂起时刻（epoch ms） */
  suspendedAt: number;
  /** 缺省 `daily_budget_exhausted` */
  reason: string;
  /** T3-12：挂起类别 —— `budget`（日预算；**放行可唤醒**）/ `guard`（熵门禁/轮上限；**放行不唤醒**） */
  kind: "budget" | "guard";
  /** 超过 24h 视为过期（协调器现算；**只过滤不删**） */
  expired: boolean;
  /** 续跑检查点引用（guard 挂起可能为 `null`） */
  checkpointRef: string | null;
}

/** 日 Token 限额状态（GET /v1/cost/daily-budget，R16 / D3） */
export interface DailyBudgetStatus {
  /** 统计所属**本地**自然日（YYYY-MM-DD） */
  date: string;
  mode: DailyBudgetMode;
  /** **主口径**单位（`"usd"` ⇔ 金额闸门启用） */
  unit: DailyBudgetUnit;
  /** **主口径**已用量（`"usd"` ⇒ 已结算金额；`"tokens"` ⇒ 当日 Token） */
  used: number;
  /** Token 口径实际已用（**辅助观测**：USD 主口径下供参考，不参与判定） */
  todayUsed: number;
  /** **Token 轨基数上限**（恒为 Token 口径；主口径为 USD 时与 `dailyLimit` 不同源） */
  tokenLimit: number;
  /** 预计用量（含在途预留；USD 主口径下无在途 ⇒ === `used`） */
  projectedUsed: number;
  /** **主口径**日上限 */
  dailyLimit: number;
  /** 已用比例（**0..1+** 的比值，非百分数；**主口径**） */
  percentUsed: number;
  /** **主口径**剩余 */
  remaining: number;
  warningThreshold: number;
  lockThreshold: number;
  killSwitch: boolean;
  /** D-d：透支欠账（**Token 口径**；`waive-once` 消耗，次日从可用额度扣回） */
  debt: number;
  /**
   * 债四 S5 / USD-1（2026-10-13，治理方案 §6.3）：**金额口径**已用（USD）。
   *
   * 与 `todayUsed` **并行的第二本账**（由后端 S8 换算接线按同一计价链入账）。
   */
  usedUsd: number;
  /** 债四 S5：金额口径欠账（USD，次日计入用量扣回） */
  debtUsd: number;
  /**
   * 债四 USD-2：金额上限（USD）。**`null` = 用户未配置** ⇒ **金额闸门不启用**
   * （Token 口径仍生效）—— 后端**不设任何默认值**（`§12 Q-U3`：由用户自主决策）。
   */
  limitUsd: number | null;
  /** 当前生效的放行（无放行 ⇒ `null`） */
  relief: DailyBudgetReliefView | null;
}

/** 日限额热更新载荷（至少一项；字段合法性由后端边界校验） */
export interface DailyBudgetUpdate {
  dailyLimit?: number;
  warningThreshold?: number;
  lockThreshold?: number;
  /**
   * 债四 USD-2：金额上限（USD）。
   *
   * - **正数** ⇒ 设置（**允许小数**，与 `dailyLimit` 的正整数口径不同）；
   * - **`null` ⇒ 清空 = 解除**（回到"未配置"）；
   * - **缺省 ⇒ 保持现值**。
   *
   * ⚠️ 后端**只接受正有限数或 `null`**：`""` / 字符串 / `0` / 负数 ⇒ **400**。
   * 表单输入框留空时**必须发 `null`**（勿发 `""`）。
   */
  dailyLimitUSD?: number | null;
}

// ─── 统一服务 ──────────────────────────────────────────────────

export const usageService = {
  // — 用量统计 (原 usageService) —
  async summary(params?: {
    startDate?: number;
    endDate?: number;
    model?: string;
    providerId?: string;
  }): Promise<UsageSummary> {
    return getOTelTracing().asyncWrap("services:usage:summary", async () => {
      const resp = await http.get<{ data: UsageSummary }>(
        ENDPOINTS.usage.summary,
        {
          params: params as Record<string, unknown>,
        },
      );
      return resp.data;
    });
  },

  async trend(params?: {
    startDate?: number;
    endDate?: number;
    model?: string;
  }): Promise<DailyUsageStats[]> {
    return getOTelTracing().asyncWrap("services:usage:trend", async () => {
      const resp = await http.get<{ data: DailyUsageStats[] }>(
        ENDPOINTS.usage.trend,
        { params: params as Record<string, unknown> },
      );
      return resp.data;
    });
  },

  async modelStats(params?: {
    startDate?: number;
    endDate?: number;
  }): Promise<ModelUsageStats[]> {
    return getOTelTracing().asyncWrap("services:usage:modelStats", async () => {
      const resp = await http.get<{ data: ModelUsageStats[] }>(
        ENDPOINTS.usage.models,
        { params: params as Record<string, unknown> },
      );
      return resp.data;
    });
  },

  async providerStats(params?: {
    startDate?: number;
    endDate?: number;
  }): Promise<ProviderUsageStats[]> {
    return getOTelTracing().asyncWrap(
      "services:usage:providerStats",
      async () => {
        const resp = await http.get<{ data: ProviderUsageStats[] }>(
          ENDPOINTS.usage.providers,
          { params: params as Record<string, unknown> },
        );
        return resp.data;
      },
    );
  },

  async logs(params?: {
    model?: string;
    providerId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    data: unknown[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return getOTelTracing().asyncWrap("services:usage:logs", async () => {
      const resp = await http.get<{
        data: {
          data: unknown[];
          total: number;
          page: number;
          pageSize: number;
        };
      }>(ENDPOINTS.usage.logs, { params: params as Record<string, unknown> });
      return resp.data;
    });
  },

  // — 成本分析 (原 costService，路径迁移到 /v1/usage/cost/*) —
  async getCostSummary(): Promise<CostSummary> {
    return getOTelTracing().asyncWrap(
      "services:usage:getCostSummary",
      async () => {
        return http.get<CostSummary>(ENDPOINTS.usage.costSummary);
      },
    );
  },

  async getCostRecords(
    page: number,
    limit: number,
  ): Promise<CostRecordsResponse> {
    return getOTelTracing().asyncWrap(
      "services:usage:getCostRecords",
      async () => {
        return http.get<CostRecordsResponse>(ENDPOINTS.usage.costRecords, {
          params: { page, limit },
        });
      },
    );
  },

  async getCostByDateRange(
    startDate: string,
    endDate: string,
  ): Promise<CostRecord[]> {
    return getOTelTracing().asyncWrap(
      "services:usage:getCostByDateRange",
      async () => {
        return http.get<CostRecord[]>(ENDPOINTS.usage.costRange, {
          params: { startDate, endDate },
        });
      },
    );
  },

  /** 对账：校验用量日志与成本记录一致性（GET /v1/usage/cost/reconcile） */
  async getCostReconcile(
    startDate?: string,
    endDate?: string,
  ): Promise<CostReconcileResult> {
    return getOTelTracing().asyncWrap(
      "services:usage:getCostReconcile",
      async () => {
        return http.get<CostReconcileResult>(ENDPOINTS.usage.costReconcile, {
          params: { startDate, endDate },
        });
      },
    );
  },

  /** 成本报表导出（GET /v1/usage/cost/report） */
  async getCostReport(
    format: "json" | "text" | "csv" | "prometheus" = "json",
    period: "today" | "week" | "month" | "custom" = "month",
  ): Promise<string> {
    return getOTelTracing().asyncWrap(
      "services:usage:getCostReport",
      async () => {
        return http.get<string>(ENDPOINTS.usage.costReport, {
          params: { format, period },
        });
      },
    );
  },

  // — 定价管理 (原 pricingService，路径不变) —
  async listPricing(): Promise<ModelPricingRecord[]> {
    return getOTelTracing().asyncWrap(
      "services:usage:listPricing",
      async () => {
        const resp = await http.get<{ data: ModelPricingRecord[] }>(
          ENDPOINTS.pricing.base,
        );
        return resp.data ?? [];
      },
    );
  },

  async upsertPricing(params: {
    modelId: string;
    displayName?: string;
    inputCostPerMillion: number;
    outputCostPerMillion: number;
    cacheReadCostPerMillion?: number;
    cacheWriteCostPerMillion?: number;
    costMultiplier?: number;
    pricingSource?: string;
  }): Promise<ModelPricingRecord> {
    return getOTelTracing().asyncWrap(
      "services:usage:upsertPricing",
      async () => {
        const resp = await http.post<{ data: ModelPricingRecord }>(
          ENDPOINTS.pricing.base,
          params,
        );
        return resp.data;
      },
    );
  },

  async removePricing(modelId: string): Promise<void> {
    return getOTelTracing().asyncWrap(
      "services:usage:removePricing",
      async () => {
        await http.delete(ENDPOINTS.pricing.byId(modelId));
      },
    );
  },

  // — 余额查询 (原 balanceService，路径迁移到 /v1/usage/balance*) —
  async checkBalance(params: {
    providerId?: string;
    baseUrl?: string;
    apiKey?: string;
  }): Promise<BalanceResult> {
    return getOTelTracing().asyncWrap(
      "services:usage:checkBalance",
      async () => {
        const resp = await http.post<{ data: BalanceResult }>(
          ENDPOINTS.usage.balance,
          params,
        );
        return resp.data;
      },
    );
  },

  async batchCheckBalance(): Promise<BalanceRecord[]> {
    return getOTelTracing().asyncWrap(
      "services:usage:batchCheckBalance",
      async () => {
        const resp = await http.get<{ data: BalanceRecord[] }>(
          ENDPOINTS.usage.balances,
        );
        return resp.data;
      },
    );
  },

  // — 日 Token 限额 (R16 / D3，路径 /v1/cost/daily-budget*) —
  /** 查询日限额状态（GET /v1/cost/daily-budget） */
  async getDailyBudget(): Promise<DailyBudgetStatus> {
    return getOTelTracing().asyncWrap(
      "services:usage:getDailyBudget",
      async () => {
        return http.get<DailyBudgetStatus>(ENDPOINTS.cost.dailyBudget);
      },
    );
  },

  /** 热更新上限/阈值（PUT /v1/cost/daily-budget）—— 服务端持久化，运行期即时生效 */
  async updateDailyBudget(
    patch: DailyBudgetUpdate,
  ): Promise<DailyBudgetStatus> {
    return getOTelTracing().asyncWrap(
      "services:usage:updateDailyBudget",
      async () => {
        return http.put<DailyBudgetStatus>(ENDPOINTS.cost.dailyBudget, patch);
      },
    );
  },

  /**
   * 查询**预算挂起清单**（GET /v1/cost/daily-budget/suspend，v1.5 A2）。
   *
   * 用途（v1.10 遗留项收口）：撞限**当时**的入口是 `DailyLimitNotice`（靠 store 的 `errorCode`）；
   * 但用户若**没当场点继续**、或**重启/切会话后回来**，`errorCode` 已不在内存态 ⇒ 此前**没有入口**
   * 继续这个"已挂起（进度已保存）"的会话。本方法即该入口的数据源：
   * 宿主据此在**当前会话**命中挂起项时渲染挂起卡片（放行 ⇒ 协调器自动续跑）。
   */
  async getDailyBudgetSuspends(): Promise<{
    sessions: BudgetSuspendEntry[];
    count: number;
  }> {
    return getOTelTracing().asyncWrap(
      "services:usage:getDailyBudgetSuspends",
      async () => {
        return http.get<{ sessions: BudgetSuspendEntry[]; count: number }>(
          ENDPOINTS.cost.dailyBudgetSuspend,
        );
      },
    );
  },

  /** 重置当日用量（POST /v1/cost/daily-budget/reset，D6） */
  async resetDailyBudget(): Promise<DailyBudgetStatus> {
    return getOTelTracing().asyncWrap(
      "services:usage:resetDailyBudget",
      async () => {
        return http.post<DailyBudgetStatus>(
          ENDPOINTS.cost.dailyBudgetReset,
          {},
        );
      },
    );
  },

  /**
   * 放行（POST /v1/cost/daily-budget/relief，D-b）：临时提额 / 单次豁免 / 当日解除。
   *
   * 参数按**结构**声明（`boost` 可带 `factor`/`amount`/`ttlMs`；`waive-once` 可带 `ttlMs`），
   * 与后端 `ReliefInput` 结构等价；非法参数由服务端 fail-loud 回 400。
   */
  async setDailyBudgetRelief(
    relief: DailyBudgetReliefInput,
  ): Promise<DailyBudgetStatus> {
    return getOTelTracing().asyncWrap(
      "services:usage:setDailyBudgetRelief",
      async () => {
        return http.post<DailyBudgetStatus>(
          ENDPOINTS.cost.dailyBudgetRelief,
          relief,
        );
      },
    );
  },

  /**
   * 撤销当前放行（DELETE /v1/cost/daily-budget/relief，D-b 对称回路）。
   *
   * 清空**全部在途放行**（临时提额 / 今日解除 / 单次豁免）并恢复为**配置上限**；
   * **保留**今日用量与欠账 —— 这是与 `resetDailyBudget()`（用量归零）的关键差异。
   * 无放行时服务端幂等返回 200。
   */
  async clearDailyBudgetRelief(): Promise<DailyBudgetStatus> {
    return getOTelTracing().asyncWrap(
      "services:usage:clearDailyBudgetRelief",
      async () => {
        return http.delete<DailyBudgetStatus>(ENDPOINTS.cost.dailyBudgetRelief);
      },
    );
  },

  /** 手动硬锁开关（POST /v1/cost/daily-budget/kill-switch，D6） */
  async setDailyBudgetKillSwitch(enabled: boolean): Promise<DailyBudgetStatus> {
    return getOTelTracing().asyncWrap(
      "services:usage:setDailyBudgetKillSwitch",
      async () => {
        return http.post<DailyBudgetStatus>(
          ENDPOINTS.cost.dailyBudgetKillSwitch,
          { enabled },
        );
      },
    );
  },
};
