import { useState } from "react";

/**
 * TTSProviderConfig — Provider 展开配置表单组件
 *
 * 根据 Provider 类型 switch/case 条件渲染不同配置项：
 *   - OpenAI：apiKey、model
 *   - Piper：executablePath、modelPath
 *   - Edge / Command：零配置提示
 */

/** Provider 配置字段 */
interface ProviderConfig {
  [key: string]: string;
}

/** TTSProviderConfig 组件 Props */
interface TTSProviderConfigProps {
  /** Provider 名称 */
  providerName: string;
  /** 初始配置值（可选） */
  initialConfig?: ProviderConfig;
  /** 保存配置回调 */
  onSave: (config: ProviderConfig) => void;
  /** 是否为保存中状态 */
  saving?: boolean;
}

/**
 * Provider 展开配置表单
 *
 * @param providerName - Provider 名称，用于 switch/case 决定渲染内容
 * @param initialConfig - 初始配置值
 * @param onSave - 保存配置回调
 * @param saving - 是否保存中
 */
function TTSProviderConfig({
  providerName,
  initialConfig = {},
  onSave,
  saving = false,
}: TTSProviderConfigProps) {
  const [config, setConfig] = useState<ProviderConfig>({ ...initialConfig });

  const handleChange = (field: string, value: string): void => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = (): void => {
    onSave(config);
  };

  switch (providerName.toLowerCase()) {
    case "openaitts":
    case "openai": {
      return (
        <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-700/30 rounded">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              API Key
            </label>
            <input
              type="password"
              value={config.apiKey || ""}
              onChange={(e) => handleChange("apiKey", e.target.value)}
              placeholder="sk-..."
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              模型
            </label>
            <input
              type="text"
              value={config.model || "tts-1"}
              onChange={(e) => handleChange("model", e.target.value)}
              placeholder="tts-1"
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存配置"}
          </button>
        </div>
      );
    }

    case "pipertts":
    case "piper": {
      return (
        <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-700/30 rounded">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              可执行文件路径
            </label>
            <input
              type="text"
              value={config.executablePath || ""}
              onChange={(e) => handleChange("executablePath", e.target.value)}
              placeholder="/usr/local/bin/piper"
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              模型路径
            </label>
            <input
              type="text"
              value={config.modelPath || ""}
              onChange={(e) => handleChange("modelPath", e.target.value)}
              placeholder="/models/piper/zh_CN-hf-medium.onnx"
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存配置"}
          </button>
        </div>
      );
    }

    case "edgetts":
    case "edge":
    case "commandtts":
    case "command":
    default: {
      // Edge / Command 等零配置 Provider，或未知 Provider
      return (
        <div className="p-3 bg-gray-50 dark:bg-gray-700/30 rounded text-sm text-gray-500 dark:text-gray-400">
          此提供者无需额外配置。
        </div>
      );
    }
  }
}

export default TTSProviderConfig;
