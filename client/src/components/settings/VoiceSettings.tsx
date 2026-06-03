import { useEffect, useState } from "react";
import { useVoiceStore } from "../../stores/voiceStore";
import type { VoiceProvider } from "../../services/voiceService";

interface VoiceSettingsProps {
  isDark: boolean;
}

const PROVIDER_LABELS: Record<VoiceProvider, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  webapi: "系统默认",
};

function VoiceSettings({ isDark }: VoiceSettingsProps) {
  const { settings, isProcessing, error, loadSettings, updateSettings } =
    useVoiceStore();
  const [localConfig, setLocalConfig] = useState(settings?.config);

  useEffect(() => {
    if (!settings) {
      loadSettings();
    }
  }, [loadSettings, settings]);

  useEffect(() => {
    if (settings?.config) {
      setLocalConfig(settings.config);
    }
  }, [settings]);

  const handleSave = async () => {
    if (localConfig) {
      await updateSettings({ config: localConfig });
    }
  };

  if (!settings || !localConfig) {
    return (
      <div
        className={`flex items-center justify-center p-8 ${isDark ? "text-gray-400" : "text-gray-500"}`}
      >
        <svg
          className="w-6 h-6 animate-spin mr-2"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        加载中...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div
          className={`p-3 rounded-lg text-sm ${isDark ? "bg-red-900/30 text-red-400" : "bg-red-50 text-red-600"}`}
        >
          {error}
        </div>
      )}

      <div>
        <h3
          className={`text-lg font-medium mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          语音提供方
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {(["gemini", "openai", "webapi"] as VoiceProvider[]).map(
            (provider) => (
              <button
                key={provider}
                onClick={() => setLocalConfig({ ...localConfig, provider })}
                className={`p-3 rounded-lg border text-center transition-colors ${
                  localConfig.provider === provider
                    ? isDark
                      ? "bg-blue-900/30 border-blue-500 text-blue-400"
                      : "bg-blue-50 border-blue-500 text-blue-600"
                    : isDark
                      ? "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600"
                      : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
                }`}
              >
                <span className="block text-sm font-medium">
                  {PROVIDER_LABELS[provider]}
                </span>
              </button>
            ),
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            className={`block text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
          >
            输入语言
          </label>
          <select
            value={localConfig.inputLanguage}
            onChange={(e) =>
              setLocalConfig({ ...localConfig, inputLanguage: e.target.value })
            }
            className={`w-full px-3 py-2 rounded-lg border ${
              isDark
                ? "bg-gray-800 border-gray-700 text-white"
                : "bg-white border-gray-300 text-gray-900"
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            <option value="auto">自动检测</option>
            <option value="zh-CN">中文</option>
            <option value="en-US">英语</option>
            <option value="ja-JP">日语</option>
            <option value="ko-KR">韩语</option>
          </select>
        </div>

        <div>
          <label
            className={`block text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
          >
            输出语言
          </label>
          <select
            value={localConfig.outputLanguage}
            onChange={(e) =>
              setLocalConfig({ ...localConfig, outputLanguage: e.target.value })
            }
            className={`w-full px-3 py-2 rounded-lg border ${
              isDark
                ? "bg-gray-800 border-gray-700 text-white"
                : "bg-white border-gray-300 text-gray-900"
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            <option value="zh-CN">中文</option>
            <option value="en-US">英语</option>
            <option value="ja-JP">日语</option>
            <option value="ko-KR">韩语</option>
          </select>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <label
              className={`block text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              语音唤醒
            </label>
            <p
              className={`text-xs mt-0.5 ${isDark ? "text-gray-500" : "text-gray-400"}`}
            >
              启用后可通过语音唤醒词激活语音输入
            </p>
          </div>
          <button
            onClick={() =>
              setLocalConfig({
                ...localConfig,
                wakeWordEnabled: !localConfig.wakeWordEnabled,
              })
            }
            className={`relative w-12 h-6 rounded-full transition-colors ${
              localConfig.wakeWordEnabled
                ? "bg-blue-500"
                : isDark
                  ? "bg-gray-600"
                  : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                localConfig.wakeWordEnabled ? "left-7" : "left-1"
              }`}
            />
          </button>
        </div>

        {localConfig.wakeWordEnabled && (
          <div>
            <label
              className={`block text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              唤醒词
            </label>
            <input
              type="text"
              value={localConfig.wakeWord}
              onChange={(e) =>
                setLocalConfig({ ...localConfig, wakeWord: e.target.value })
              }
              placeholder="例如：嘿，助手"
              className={`w-full px-3 py-2 rounded-lg border ${
                isDark
                  ? "bg-gray-800 border-gray-700 text-white"
                  : "bg-white border-gray-300 text-gray-900"
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div>
          <label
            className={`block text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
          >
            自动播放 TTS
          </label>
          <p
            className={`text-xs mt-0.5 ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            AI回复时自动朗读文本
          </p>
        </div>
        <button
          onClick={() =>
            setLocalConfig({
              ...localConfig,
              autoPlayTTS: !localConfig.autoPlayTTS,
            })
          }
          className={`relative w-12 h-6 rounded-full transition-colors ${
            localConfig.autoPlayTTS
              ? "bg-blue-500"
              : isDark
                ? "bg-gray-600"
                : "bg-gray-300"
          }`}
        >
          <span
            className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
              localConfig.autoPlayTTS ? "left-7" : "left-1"
            }`}
          />
        </button>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={isProcessing}
          className={`px-4 py-2 rounded-lg font-medium ${
            isDark
              ? "bg-blue-600 hover:bg-blue-700 text-white"
              : "bg-blue-600 hover:bg-blue-700 text-white"
          } disabled:opacity-50`}
        >
          {isProcessing ? "保存中..." : "保存设置"}
        </button>
      </div>
    </div>
  );
}

export default VoiceSettings;
