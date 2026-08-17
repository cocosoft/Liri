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
 * ChannelMetricsCard — 渠道消息可观测性指标卡片
 *
 * 数据源：GET /v1/channels/metrics（channels.* 系列指标）
 * 展示：入站/拒绝/发送/广播计数、拒绝原因分布、
 *       各渠道消息处理平均耗时（含 LLM 往返）、各平台出站发送成功率。
 */
import { useEffect, useState } from "react";
import { channelService } from "../../services/channelService";
import type { ChannelMetricEntry, ChannelMetricsResponse } from "../../types";
import { handleClientError } from "../../utils/handleError";

/** 解析后端指标 key：`name{label=k,v}` → { name, labels } */
function parseMetricKey(key: string): {
  name: string;
  labels: Record<string, string>;
} {
  const brace = key.indexOf("{");
  if (brace === -1) return { name: key, labels: {} };
  const name = key.slice(0, brace);
  const labelStr = key.slice(brace + 1, key.length - 1);
  const labels: Record<string, string> = {};
  for (const part of labelStr.split(",")) {
    const eq = part.indexOf("=");
    if (eq !== -1) labels[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return { name, labels };
}

interface ChannelProcessingStat {
  count: number;
  avgMs: number;
}

interface ChannelSendStat {
  ok: number;
  fail: number;
}

interface ChannelMetricsAggregate {
  inbound: number;
  rejected: number;
  broadcast: number;
  rejectedByReason: Record<string, number>;
  processingByChannel: Record<string, ChannelProcessingStat>;
  sendByPlatform: Record<string, ChannelSendStat>;
}

/** 聚合 channels.* 系列指标条目为可读结构 */
function aggregate(entries: ChannelMetricEntry[]): ChannelMetricsAggregate {
  const agg: ChannelMetricsAggregate = {
    inbound: 0,
    rejected: 0,
    broadcast: 0,
    rejectedByReason: {},
    processingByChannel: {},
    sendByPlatform: {},
  };

  for (const entry of entries) {
    const { name, labels } = parseMetricKey(entry.key);
    const value = entry.value ?? 0;

    if (name === "channels.message.inbound_total") {
      agg.inbound += value;
    } else if (name === "channels.message.rejected_total") {
      agg.rejected += value;
      const reason = labels.reason || "unknown";
      agg.rejectedByReason[reason] =
        (agg.rejectedByReason[reason] || 0) + value;
    } else if (name === "channels.delivery.broadcast_total") {
      agg.broadcast += value;
    } else if (name === "channels.message.processing_ms") {
      const channel = labels.channel || "unknown";
      const count = entry.count ?? 0;
      const sum = entry.sum ?? 0;
      agg.processingByChannel[channel] = {
        count,
        avgMs: count > 0 ? Math.round(sum / count) : 0,
      };
    } else if (name === "channels.delivery.send_total") {
      const platform = labels.platform || "unknown";
      const result = labels.result || "fail";
      const current = agg.sendByPlatform[platform] || { ok: 0, fail: 0 };
      if (result === "ok") current.ok += value;
      else current.fail += value;
      agg.sendByPlatform[platform] = current;
    }
  }

  return agg;
}

/** 概览小数字块 */
function Overview({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-2">
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className="text-lg font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

export function ChannelMetricsCard() {
  const [metrics, setMetrics] = useState<ChannelMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await channelService.getMetrics();
        if (!cancelled) {
          setMetrics(data);
          setError(null);
        }
      } catch (e) {
        if (cancelled) return;
        handleClientError(e, {
          module: "dashboard",
          action: "loadChannelMetrics",
        });
        setError("渠道指标加载失败");
      }
    };
    load();
    // 渠道指标实时性较高，每 10s 轮询一次自动更新
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const agg = metrics ? aggregate(metrics.metrics) : null;
  const hasData =
    agg !== null && (agg.inbound > 0 || agg.rejected > 0 || agg.broadcast > 0);

  const sendTotals = Object.values(agg?.sendByPlatform ?? {}).reduce(
    (acc, v) => ({ ok: acc.ok + v.ok, fail: acc.fail + v.fail }),
    { ok: 0, fail: 0 },
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">📊</span>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          渠道消息指标
        </h3>
      </div>

      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
      {!agg && !error && (
        <p className="text-xs text-gray-400">正在加载渠道指标…</p>
      )}
      {agg && !hasData && (
        <p className="text-xs text-gray-400">暂无消息活动数据</p>
      )}

      {agg && hasData && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
            <Overview label="入站消息" value={agg.inbound} />
            <Overview label="拒绝/跳过" value={agg.rejected} />
            <Overview label="发送成功" value={sendTotals.ok} />
            <Overview label="发送失败" value={sendTotals.fail} />
            <Overview label="广播" value={agg.broadcast} />
          </div>

          {Object.keys(agg.rejectedByReason).length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-400 mb-1">拒绝原因分布</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(agg.rejectedByReason).map(([reason, count]) => (
                  <span
                    key={reason}
                    className="text-[11px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                  >
                    {reason}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {Object.keys(agg.processingByChannel).length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-400 mb-1">
                消息处理平均耗时（含 LLM 往返）
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(agg.processingByChannel).map(
                  ([channel, stat]) => (
                    <span
                      key={channel}
                      className="text-[11px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                    >
                      {channel}: {stat.avgMs}ms（{stat.count} 条）
                    </span>
                  ),
                )}
              </div>
            </div>
          )}

          {Object.keys(agg.sendByPlatform).length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">出站发送成功率</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(agg.sendByPlatform).map(([platform, stat]) => {
                  const total = stat.ok + stat.fail;
                  const rate =
                    total > 0 ? ((stat.ok / total) * 100).toFixed(0) : "0";
                  return (
                    <span
                      key={platform}
                      className="text-[11px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                    >
                      {platform}: {rate}%（{stat.ok}/{total}）
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
