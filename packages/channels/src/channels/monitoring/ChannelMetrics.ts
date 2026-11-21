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
 * ChannelMetrics — 渠道模块可观测性指标
 *
 * 补齐渠道模块"指标"空白（日志/追踪/健康检查此前已有覆盖）：
 *  - 入站消息总数 + 处理耗时（messageRouter 埋点，**按渠道**分维）
 *  - 拒绝/跳过原因计数（messageRouter 埋点，**按渠道 + 原因**分维）
 *  - 出站发送计数 + 耗时（DeliveryRouter 埋点）
 *  - 广播总数（DeliveryRouter 埋点）
 *
 * 与 voice 模块（voice.stt.latency_ms 直方图）模式对齐：
 * 按维度懒建 counter/histogram 并缓存，避免每次调用重建指标实例。
 * 指标经 MetricsService 统一管理，由 AppCoreOTelHelper 的 MetricsBridge 桥接到 OTel。
 */

import { getMetricsService } from '@openliri/infra/monitoring';
import type {
  CounterMetric,
  HistogramMetric,
} from '@openliri/infra/monitoring';

// 惰性初始化：顶层 getMetricsService() 会在 monitoring 模块半初始化时触发 TDZ（循环导入）。
// 指标在首次记录时创建并缓存。
//
// 2026-11-21（入站监视 G1）：入站计数**按渠道**分维 —— 原先只有无渠道单例，
// 「哪个渠道进来多少条」只能翻内存链路缓冲。改为按渠道懒建后**必须删除旧单例**：
// 同名指标若同时存在「无 channel」与「有 channel」两套序列，前端按名求和会翻倍
// （`ChannelMetricsCard` 的 inbound 就是求和口径）。
let _broadcastTotal: CounterMetric | undefined;
function getBroadcastTotal(): CounterMetric {
  _broadcastTotal ??= getMetricsService().createCounter({
    name: 'channels.delivery.broadcast_total',
    description: '渠道广播总数',
    labels: { module: 'channels:delivery' },
  });
  return _broadcastTotal;
}

/** 按 channel 懒建的入站计数缓存 */
const inboundCounters = new Map<string, CounterMetric>();
/** 按 `channel:reason` 懒建的消息拒绝/跳过计数缓存 */
const rejectedCounters = new Map<string, CounterMetric>();
/** 按 channel 懒建的消息处理耗时直方图缓存 */
const processingHistograms = new Map<string, HistogramMetric>();
/** 按 platform:result 懒建的出站发送计数缓存 */
const sendCounters = new Map<string, CounterMetric>();
/** 按 platform 懒建的出站发送耗时直方图缓存 */
const sendHistograms = new Map<string, HistogramMetric>();

/**
 * 记录一条入站消息（**按渠道**分维）
 * 在 routeChannelMessage 入口调用。
 *
 * @param channelName 渠道名 —— **必填**（`messageRouter` 已在入口把缺省值归一，
 *   避免本文件再出现一份"未知渠道"字面量：状态字面量棘轮门禁要求字面量只有一处真源）
 */
export function recordInboundMessage(channelName: string): void {
  let counter = inboundCounters.get(channelName);
  if (!counter) {
    counter = getMetricsService().createCounter({
      name: 'channels.message.inbound_total',
      description: `渠道入站消息总数（${channelName}）`,
      labels: { module: 'channels:routing', channel: channelName },
    });
    inboundCounters.set(channelName, counter);
  }
  counter.inc();
}

/**
 * 记录一次消息拒绝/跳过（**按渠道 + 原因**分维）
 * reason 取各分支的 errorCode 或跳过类型
 * （INVALID_FRAME / UNAUTHORIZED / duplicate / inflight / content_dedup /
 *   RATE_LIMITED / LLM_ERROR / INBOX_UNAVAILABLE / SESSION_BUSY / INGEST_FUNNEL /
 *   EMPTY_LLM_RESPONSE / INVALID_ID）。
 *
 * @param channelName 渠道名 —— **必填**（缺省归一由 routeChannelMessage 入口承担）
 */
export function recordMessageRejected(
  reason: string,
  channelName: string
): void {
  const key = `${channelName}:${reason}`;
  let counter = rejectedCounters.get(key);
  if (!counter) {
    counter = getMetricsService().createCounter({
      name: 'channels.message.rejected_total',
      description: `渠道消息拒绝/跳过计数（${channelName}/${reason}）`,
      labels: { module: 'channels:routing', channel: channelName, reason },
    });
    rejectedCounters.set(key, counter);
  }
  counter.inc();
}

/**
 * 记录一次消息处理耗时（含 LLM 调用）
 * 按 channel 维度建立直方图，供排查慢通道/慢 LLM 往返参考。
 */
export function recordMessageProcessing(
  channelName: string,
  durationMs: number
): void {
  let histogram = processingHistograms.get(channelName);
  if (!histogram) {
    histogram = getMetricsService().createHistogram({
      name: 'channels.message.processing_ms',
      description: `渠道消息处理耗时（${channelName}，ms）`,
      labels: { module: 'channels:routing', channel: channelName },
    });
    processingHistograms.set(channelName, histogram);
  }
  histogram.observe(durationMs);
}

/**
 * 记录一次出站发送
 * 按 platform + 结果（ok/fail）维度建立计数，可统计各渠道发送成功率。
 */
export function recordDeliverySend(platform: string, success: boolean): void {
  const result = success ? 'ok' : 'fail';
  const key = `${platform}:${result}`;
  let counter = sendCounters.get(key);
  if (!counter) {
    counter = getMetricsService().createCounter({
      name: 'channels.delivery.send_total',
      description: `渠道出站发送计数（${platform}/${result}）`,
      labels: { module: 'channels:delivery', platform, result },
    });
    sendCounters.set(key, counter);
  }
  counter.inc();
}

/**
 * 记录一次出站发送耗时
 * 按 platform 维度建立直方图，供排查发送慢的渠道。
 */
export function recordDeliverySendLatency(
  platform: string,
  durationMs: number
): void {
  let histogram = sendHistograms.get(platform);
  if (!histogram) {
    histogram = getMetricsService().createHistogram({
      name: 'channels.delivery.send_ms',
      description: `渠道出站发送耗时（${platform}，ms）`,
      labels: { module: 'channels:delivery', platform },
    });
    sendHistograms.set(platform, histogram);
  }
  histogram.observe(durationMs);
}

/**
 * 记录一次广播
 * 在 DeliveryRouter.broadcast 调用时 +1。
 */
export function recordBroadcast(): void {
  getBroadcastTotal().inc();
}

/**
 * 仅供测试：清空按维度缓存的指标句柄（下次记录时重建同名条目，值归零）。
 *
 * 与 `resetToolMetricsForTest` 同口径 —— MetricsService 是进程级单例，
 * 缓存不清会让跨文件测试互相污染（测试辅助，非生产路径）。
 */
export function resetChannelMetricsForTest(): void {
  inboundCounters.clear();
  rejectedCounters.clear();
  processingHistograms.clear();
  sendCounters.clear();
  sendHistograms.clear();
  _broadcastTotal = undefined;
}
