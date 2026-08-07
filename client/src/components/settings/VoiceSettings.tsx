import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useVoiceStore } from "../../stores/voiceStore";
import type { VoiceProvider } from "../../services/voiceService";
import { voiceService } from "../../services/voiceService";
import { ConfigSection, ConfigItem, ToggleConfig } from "./ConfigComponents";

interface VoiceSettingsProps {
  isDark: boolean;
}

const PROVIDER_LABELS: Record<VoiceProvider, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  webapi: "系统默认",
};

/** STT 引擎显示名称映射 */
const STT_PROVIDER_LABELS: Record<string, string> = {
  local: "本地 Whisper",
  cloud: "OpenAI API",
  stream: "流式 STT",
  sensevoice: "SenseVoice 中文",
};

const DEFAULT_TRIGGERS = ["小鸟小鸟", "Hi Liri"];

/** 唤醒词状态机：idle → listening → triggered → recording → idle */
type WakeWordStatus = "idle" | "listening" | "triggered" | "recording";

/** 从现有 store 字段推导当前唤醒状态 */
function getWakeWordStatus(
  enabled: boolean,
  listening: boolean,
  triggered: string | null,
  isRecording: boolean,
  isProcessing: boolean,
): WakeWordStatus {
  if (!enabled) return "idle";
  if (isRecording || isProcessing) return "recording";
  if (triggered) return "triggered";
  if (listening) return "listening";
  return "idle";
}

function VoiceSettings({ isDark }: VoiceSettingsProps) {
  const { t } = useTranslation();
  const {
    settings,
    isProcessing,
    error,
    loadSettings,
    updateSettings,
    wakeWordEnabled,
    wakeWordTriggers,
    wakeWordListening,
    wakeWordTriggered,
    isRecording,
    toggleWakeWord,
    setWakeWordTriggers,
  } = useVoiceStore();

  /** 当前唤醒状态机状态 */
  const wakeWordStatus = getWakeWordStatus(
    wakeWordEnabled,
    wakeWordListening,
    wakeWordTriggered,
    isRecording,
    isProcessing,
  );
  const [localConfig, setLocalConfig] = useState(settings?.config);
  const [newTrigger, setNewTrigger] = useState("");

  /** STT 引擎列表（从后端动态加载） */
  const [sttProviders, setSttProviders] = useState<string[]>([]);
  /** TTS 音色列表（聊天自动朗读用，edge 提供） */
  const [voices, setVoices] = useState<
    { id: string; name: string; language: string }[]
  >([]);
  const [voiceLoading, setVoiceLoading] = useState(false);

  /** 添加新唤醒词，更新 store */
  const addTrigger = useCallback(() => {
    const trimmed = newTrigger.trim();
    if (!trimmed) return;
    if (!wakeWordTriggers.includes(trimmed)) {
      setWakeWordTriggers([...wakeWordTriggers, trimmed]);
    }
    setNewTrigger("");
  }, [newTrigger, wakeWordTriggers, setWakeWordTriggers]);

  /** 初始化默认唤醒词列表 */
  useEffect(() => {
    if (wakeWordTriggers.length === 0) {
      setWakeWordTriggers(DEFAULT_TRIGGERS);
    }
  }, [wakeWordTriggers.length, setWakeWordTriggers]);

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

  /** 加载可用 STT 引擎列表 */
  useEffect(() => {
    voiceService
      .getProviders()
      .then(setSttProviders)
      .catch(() => {
        // 加载失败时使用默认列表
        setSttProviders(["local", "cloud", "stream"]);
      });
  }, []);

  /** 加载 TTS 音色列表（聊天自动朗读用，默认 edge） */
  useEffect(() => {
    setVoiceLoading(true);
    voiceService
      .getVoices("edge")
      .then(setVoices)
      .catch(() => {
        // 音色列表不可用时留空，下拉提供手动输入回退
        setVoices([]);
      })
      .finally(() => setVoiceLoading(false));
  }, []);

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
        {t("common.loading")}
      </div>
    );
  }

  return (
    <ConfigSection isDark={isDark}>
      <div className="space-y-4">
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

        {/* STT 语音识别引擎选择 */}
        <div>
          <h3
            className={`text-lg font-medium mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            STT 识别引擎
          </h3>
          <p
            className={`text-xs mb-3 ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            选择语音转文字使用的引擎
          </p>
          <div className="grid grid-cols-3 gap-3">
            {sttProviders.map((providerId) => {
              const label = STT_PROVIDER_LABELS[providerId] || providerId;
              const isSelected = localConfig.sttProviderId === providerId;
              return (
                <button
                  key={providerId}
                  onClick={() =>
                    setLocalConfig({
                      ...localConfig,
                      sttProviderId: providerId,
                    })
                  }
                  className={`p-3 rounded-lg border text-center transition-colors ${
                    isSelected
                      ? isDark
                        ? "bg-green-900/30 border-green-500 text-green-400"
                        : "bg-green-50 border-green-500 text-green-600"
                      : isDark
                        ? "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600"
                        : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
                  }`}
                >
                  <span className="block text-sm font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <ConfigItem
          label="流式字幕识别"
          description="按住说话时实时显示后端流式 STT 字幕；关闭时降级浏览器语音识别"
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={localConfig.useStreamingSTT !== false}
            onChange={() =>
              setLocalConfig({
                ...localConfig,
                useStreamingSTT: !(localConfig.useStreamingSTT !== false),
              })
            }
          />
        </ConfigItem>

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
                setLocalConfig({
                  ...localConfig,
                  inputLanguage: e.target.value,
                })
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
                setLocalConfig({
                  ...localConfig,
                  outputLanguage: e.target.value,
                })
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

        <ConfigItem
          label="语音唤醒"
          description="启用后可通过唤醒词激活语音输入"
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={wakeWordEnabled}
            onChange={() => toggleWakeWord()}
          />
        </ConfigItem>

        {wakeWordEnabled && (
          <div className="space-y-3 border-l-2 border-blue-400 pl-4">
            {/* 唤醒状态机指示器：idle → listening → triggered → recording → idle */}
            {wakeWordStatus === "listening" && (
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                <span
                  className={`text-xs ${isDark ? "text-green-400" : "text-green-600"}`}
                >
                  正在监听唤醒词...
                </span>
              </div>
            )}
            {wakeWordStatus === "triggered" && (
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping" />
                <span
                  className={`text-xs font-medium ${isDark ? "text-blue-400" : "text-blue-600"}`}
                >
                  已触发：{wakeWordTriggered}
                </span>
              </div>
            )}
            {wakeWordStatus === "recording" && (
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span
                  className={`text-xs ${isDark ? "text-red-400" : "text-red-600"}`}
                >
                  语音输入已激活
                  {wakeWordTriggered ? `（唤醒词：${wakeWordTriggered}）` : ""}
                </span>
              </div>
            )}
            {wakeWordStatus === "idle" && (
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-400" />
                <span
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  唤醒监听未启动
                </span>
              </div>
            )}

            {/* 唤醒词列表 */}
            <div>
              <label
                className={`block text-xs font-medium mb-1.5 ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                唤醒词列表
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {wakeWordTriggers.map((trigger, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs ${
                      isDark
                        ? "bg-gray-700 text-gray-200"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {trigger}
                    <button
                      onClick={() => {
                        const next = wakeWordTriggers.filter((_, j) => j !== i);
                        setWakeWordTriggers(next);
                      }}
                      className="ml-0.5 hover:text-red-500"
                      title="移除"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTrigger}
                  onChange={(e) => setNewTrigger(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newTrigger.trim()) {
                      addTrigger();
                    }
                  }}
                  placeholder="输入新唤醒词，回车添加"
                  className={`flex-1 px-3 py-1.5 text-sm rounded-lg border ${
                    isDark
                      ? "bg-gray-800 border-gray-700 text-white"
                      : "bg-white border-gray-300 text-gray-900"
                  } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                />
                <button
                  onClick={addTrigger}
                  disabled={!newTrigger.trim()}
                  className={`px-3 py-1.5 text-sm rounded-lg font-medium ${
                    isDark
                      ? "bg-blue-600 hover:bg-blue-700 text-white"
                      : "bg-blue-600 hover:bg-blue-700 text-white"
                  } disabled:opacity-50`}
                >
                  添加
                </button>
              </div>
            </div>
          </div>
        )}

        <ConfigItem
          label="自动播放 TTS"
          description="AI回复时自动朗读文本"
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={localConfig.autoPlayTTS}
            onChange={() =>
              setLocalConfig({
                ...localConfig,
                autoPlayTTS: !localConfig.autoPlayTTS,
              })
            }
          />
        </ConfigItem>

        <ConfigItem
          label="TTS 音色"
          description="AI回复朗读使用的音色（可输入或从列表选择）"
          isDark={isDark}
        >
          <input
            type="text"
            list="voice-options"
            value={localConfig.voiceId || ""}
            onChange={(e) =>
              setLocalConfig({ ...localConfig, voiceId: e.target.value })
            }
            placeholder={
              voiceLoading ? "加载音色中..." : "如 zh-CN-XiaoxiaoNeural"
            }
            className={`w-full px-3 py-2 rounded-lg border ${
              isDark
                ? "bg-gray-800 border-gray-700 text-white"
                : "bg-white border-gray-300 text-gray-900"
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
          <datalist id="voice-options">
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.language})
              </option>
            ))}
          </datalist>
        </ConfigItem>

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
            {isProcessing ? "保存中..." : t("settings.saveSettings")}
          </button>
        </div>
      </div>
    </ConfigSection>
  );
}

export default VoiceSettings;
