/**
 * WechatQrCard — 微信扫码登录二维码展示卡片
 *
 * 当编辑微信渠道时，自动轮询获取 weixin-cli 状态并显示二维码。
 * 用户在浏览器中扫码即可完成登录，无需在终端操作。
 */

import { useEffect, useRef } from "react";
import { useChannelStore } from "../../stores/channelStore";

// ─── 状态中文映射 ──────────────────────────────────────

const STATE_LABELS: Record<string, string> = {
  idle: "未启动",
  installing: "安装中...",
  installed: "已安装",
  starting: "启动中...",
  running: "运行中",
  waiting_scan: "等待扫码",
  logged_in: "已登录",
  error: "异常",
};

const STATE_COLORS: Record<string, string> = {
  idle: "text-gray-500",
  installing: "text-blue-500",
  installed: "text-green-500",
  starting: "text-blue-500",
  running: "text-green-500",
  waiting_scan: "text-amber-500",
  logged_in: "text-green-500",
  error: "text-red-500",
};

// ─── 组件 ──────────────────────────────────────────────

function WechatQrCard() {
  const { wechatCliStatus, fetchWechatCliStatus } = useChannelStore();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 组件挂载时开始轮询，卸载时停止
  useEffect(() => {
    // 立即获取一次
    fetchWechatCliStatus();

    // 每 3 秒轮询
    pollingRef.current = setInterval(() => {
      fetchWechatCliStatus();
    }, 3_000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [fetchWechatCliStatus]);

  // 未获取到状态时显示加载
  if (!wechatCliStatus) {
    return (
      <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔄</span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            正在检测 weixin-cli 状态...
          </span>
        </div>
      </div>
    );
  }

  const { state, running, qrBase64, qrRaw, lastError, uptimeSec } =
    wechatCliStatus;

  // 已登录或运行中且已有二维码 → 显示成功
  const isReady =
    state === "logged_in" || (running && state !== "waiting_scan");

  // 等待扫码状态
  const isWaitingScan = state === "waiting_scan" || !!qrRaw;

  return (
    <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
      {/* 标题 + 状态 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📱</span>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            weixin-cli 状态
          </span>
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATE_COLORS[state] || "text-gray-500"} bg-gray-100 dark:bg-gray-800`}
        >
          {STATE_LABELS[state] || state}
        </span>
      </div>

      {/* 状态描述 */}
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-3 space-y-1">
        {state === "idle" && (
          <p>weixin-cli 未启动，保存配置后将自动安装并启动。</p>
        )}
        {state === "installing" && <p>正在安装 weixin-cli 插件，请稍候...</p>}
        {state === "installed" && <p>weixin-cli 已安装，正在自动启动...</p>}
        {state === "starting" && <p>正在启动 weixin-cli 服务...</p>}
        {state === "waiting_scan" && <p>请使用微信扫描下方二维码完成登录。</p>}
        {state === "running" && !qrRaw && <p>weixin-cli 服务运行中。</p>}
        {state === "logged_in" && <p>微信已登录，消息收发功能正常。</p>}
        {state === "error" && (
          <p className="text-red-500">
            {lastError || "weixin-cli 发生异常，请检查配置后重试。"}
          </p>
        )}
        {running && uptimeSec !== null && (
          <p className="text-gray-400">
            运行时长:{" "}
            {uptimeSec > 60
              ? `${Math.floor(uptimeSec / 60)} 分钟`
              : `${uptimeSec} 秒`}
          </p>
        )}
      </div>

      {/* 二维码显示区 */}
      {isWaitingScan && qrBase64 && (
        <div className="flex flex-col items-center gap-2 mb-2">
          <img
            src={`data:image/png;base64,${qrBase64}`}
            alt="微信登录二维码"
            className="w-48 h-48 border border-gray-200 dark:border-gray-600 rounded-lg"
          />
          <span className="text-xs text-gray-400">
            请使用微信扫一扫功能扫描二维码
          </span>
        </div>
      )}

      {/* 二维码原始链接（兜底方案） */}
      {isWaitingScan && !qrBase64 && qrRaw && (
        <div className="flex flex-col items-center gap-2 mb-2">
          <div className="w-48 h-48 flex items-center justify-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg">
            <div className="text-center p-4">
              <span className="text-3xl">📷</span>
              <p className="text-xs text-gray-500 mt-2 mt-1">二维码加载中...</p>
            </div>
          </div>
          <details className="text-xs w-full">
            <summary className="text-blue-500 cursor-pointer hover:underline text-center">
              如无法显示，请点击此处复制链接
            </summary>
            <div className="mt-2 p-2 rounded bg-gray-900 text-gray-200 font-mono text-xs break-all">
              {qrRaw}
            </div>
          </details>
        </div>
      )}

      {/* 运行中状态提示 */}
      {isReady && !qrRaw && (
        <div className="flex items-center justify-center gap-2 py-4">
          <span className="text-2xl">✅</span>
          <span className="text-sm text-green-600 dark:text-green-400">
            weixin-cli 运行正常
          </span>
        </div>
      )}

      {/* 错误详情 */}
      {state === "error" && lastError && (
        <details className="text-xs mt-2">
          <summary className="text-red-500 cursor-pointer hover:underline">
            查看错误详情
          </summary>
          <div className="mt-2 p-2 rounded bg-gray-900 text-red-300 font-mono text-xs break-all">
            {lastError}
          </div>
        </details>
      )}
    </div>
  );
}

export default WechatQrCard;
