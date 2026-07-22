import { useState, useEffect, useCallback } from "react";
import { voiceService } from "@/services/voiceService";
import TTSProviderConfig from "./TTSProviderConfig";

/**
 * TTSProviderSection — TTS Provider 配置区组件
 *
 * 展示各 Provider 状态（含健康指示器、supportedFormats）、
 * 支持点击展开内联配置表单（TTSProviderConfig）。
 *
 * 初始化时调用 GET /v1/tts/providers 获取列表。
 */

/** Provider 详情类型 */
interface ProviderDetail {
  name: string;
  supportedFormats: string[];
}

/** 健康状态指示器颜色 */
function HealthDot({ status }: { status: "ok" | "degraded" | "unknown" }) {
  const colorMap: Record<string, string> = {
    ok: "bg-green-500",
    degraded: "bg-yellow-500",
    unknown: "bg-gray-400",
  };

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colorMap[status]} mr-1.5`}
      title={`状态: ${status}`}
    />
  );
}

/**
 * Provider 配置区
 */
export function TTSProviderSection() {
  const [providers, setProviders] = useState<ProviderDetail[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  /** 加载 Provider 列表 */
  const loadProviders = useCallback(async () => {
    try {
      const list = await voiceService.getTTSProvidersDetail();
      setProviders(list);
      setError(null);
    } catch {
      // 降级：若 detail 端点不可用，尝试用基础端点
      try {
        const basic = await voiceService.getTTSProviders();
        setProviders(basic.map((name) => ({ name, supportedFormats: [] })));
        setError(null);
      } catch {
        setError("无法加载 TTS 提供商列表");
      }
    }
  }, []);

  /** 初始化加载 + 页面可见时每 60s 轮询（§5.6 健康检测） */
  useEffect(() => {
    loadProviders();

    let interval: ReturnType<typeof setInterval>;

    const startPolling = () => {
      interval = setInterval(loadProviders, 60_000);
    };
    const stopPolling = () => {
      clearInterval(interval);
    };

    // 页面可见时启动轮询，不可见时暂停以减少不必要的后端请求
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        startPolling();
      } else {
        stopPolling();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    startPolling();

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadProviders]);

  /** 切换展开/折叠 */
  const toggleExpand = (name: string): void => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  /** 保存 Provider 配置 */
  const handleSaveConfig = async (
    providerName: string,
    config: Record<string, string>,
  ): Promise<void> => {
    setSaving((prev) => ({ ...prev, [providerName]: true }));
    setError(null);

    try {
      await voiceService.saveProviderConfig(providerName, config);
    } catch {
      setError(`保存 ${providerName} 配置失败`);
    } finally {
      setSaving((prev) => ({ ...prev, [providerName]: false }));
    }
  };

  if (providers.length === 0) {
    return (
      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
          Provider 配置
        </h3>
        <p className="text-sm text-gray-400">暂无可用 TTS 提供商</p>
      </section>
    );
  }

  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
        Provider 配置
      </h3>

      {error && (
        <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded text-sm">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {providers.map((provider) => (
          <div
            key={provider.name}
            className="bg-gray-50 dark:bg-gray-700/50 rounded overflow-hidden"
          >
            {/* Provider 标题行 */}
            <button
              onClick={() => toggleExpand(provider.name)}
              className="w-full flex items-center justify-between p-3 hover:bg-gray-100 dark:hover:bg-gray-700/80 transition-colors"
            >
              <div className="flex items-center gap-2">
                <HealthDot status="unknown" />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {provider.name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {provider.supportedFormats &&
                  provider.supportedFormats.length > 0 && (
                    <span className="text-xs text-gray-400">
                      {provider.supportedFormats.join(", ")}
                    </span>
                  )}
                <span className="text-xs text-gray-400">
                  {expanded[provider.name] ? "收起 ▲" : "展开 ▼"}
                </span>
              </div>
            </button>

            {/* 展开配置表单 */}
            {expanded[provider.name] && (
              <div className="px-3 pb-3">
                <TTSProviderConfig
                  providerName={provider.name}
                  onSave={(config) => handleSaveConfig(provider.name, config)}
                  saving={saving[provider.name]}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
