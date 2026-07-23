// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
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
 * 用量仪表盘组件
 * 展示 API 使用统计概览、余额、模型使用排行、供应商排行
 * 替代原 ModelCompare 鸡肋组件
 */

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { balanceService } from "../../services/balanceService";
import { handleClientError } from "../../utils/handleError";
import type {
  BalanceRecord,
} from "../../types";

/**
 * 用量仪表盘
 */
export default function UsageDashboard() {
  const navigate = useNavigate();
  const [balances, setBalances] = useState<BalanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const b = await balanceService.batchCheck();
      setBalances(b);
    } catch (e) {
      handleClientError(e, { module: "components:modelAdmin:UsageDashboard", action: "loadData" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 查看完整报告 */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <p className="text-sm text-blue-700 dark:text-blue-300 mb-2">
          完整的成本监控和 Token 使用统计已迁移至独立页面。
        </p>
        <button
          onClick={() => navigate('/cost')}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
        >
          查看完整报告 →
        </button>
      </div>

      {/* 余额概览 */}
      <BalanceSection balances={balances} onRefresh={loadData} />
    </div>
  );
}

/** 余额概览区域 */
function BalanceSection({
  balances,
  onRefresh,
}: {
  balances: BalanceRecord[];
  onRefresh: () => void;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          余额概览
        </h3>
        <button
          onClick={onRefresh}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          刷新
        </button>
      </div>
      {balances.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">暂无余额数据</p>
      ) : (
        <div className="space-y-2">
          {balances.map((b) => (
            <div
              key={b.providerId}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  {b.providerName}
                </span>
                <span className="text-xs text-gray-400">{b.providerType}</span>
                {b.belowThreshold && (
                  <span className="text-xs px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded">
                    余额不足
                  </span>
                )}
                {!b.supported && (
                  <span className="text-xs px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 rounded">
                    不支持余额查询
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {b.remaining !== null ? (
                  <span
                    className={`font-mono ${b.belowThreshold ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-gray-300"}`}
                  >
                    {b.remaining.toFixed(2)} {b.unit}
                    {b.total !== null
                      ? ` / ${b.total.toFixed(2)} ${b.unit}`
                      : ""}
                  </span>
                ) : (
                  <span className="text-gray-400">--</span>
                )}
                {b.queriedAt && (
                  <span className="text-xs text-gray-400">
                    {new Date(b.queriedAt * 1000).toLocaleTimeString("zh-CN")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
