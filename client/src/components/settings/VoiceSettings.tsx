import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useVoiceStore } from "../../stores/voiceStore";
import type { VoiceProvider } from "../../services/voiceService";
import { voiceService } from "../../services/voiceService";
import { ConfigSection, ConfigItem, ToggleConfig } from "./ConfigComponents";

interface VoiceSettingsProps {
  isDark: boolean;
}

const PROVIDER_LABELS: Record<VoiceProvider, string | null> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  webapi: null,
};

/** STT 引擎显示名称映射 */
const STT_PROVIDER_LABEL_KEYS: Record<string, string> = {
  local: "settings.sttLocal",
  cloud: "settings.sttCloud",
  stream: "settings.sttStream",
  sensevoice: "settings.sttSenseVoice",
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
            {t("settings.voiceProviderSection")}
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
                    {PROVIDER_LABELS[provider] ??
                      t("settings.voiceProviderSystem")}
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
            {t("settings.voiceSttSection")}
          </h3>
          <p
            className={`text-xs mb-3 ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            {t("settings.voiceSttSectionDesc")}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {sttProviders.map((providerId) => {
              const label = STT_PROVIDER_LABEL_KEYS[providerId]
                ? t(STT_PROVIDER_LABEL_KEYS[providerId])
                : providerId;
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
          label={t("settings.voiceStreamingStt")}
          description={t("settings.voiceStreamingSttDesc")}
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
              {t("settings.voiceInputLanguage")}
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
              <option value="auto">{t("settings.langAuto")}</option>
              <option value="zh-CN">{t("settings.langChinese")}</option>
              <option value="en-US">{t("settings.langEnglish")}</option>
              <option value="ja-JP">{t("settings.langJapanese")}</option>
              <option value="ko-KR">{t("settings.langKorean")}</option>
            </select>
          </div>

          <div>
            <label
              className={`block text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              {t("settings.voiceOutputLanguage")}
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
              <option value="zh-CN">{t("settings.langChinese")}</option>
              <option value="en-US">{t("settings.langEnglish")}</option>
              <option value="ja-JP">{t("settings.langJapanese")}</option>
              <option value="ko-KR">{t("settings.langKorean")}</option>
            </select>
          </div>
        </div>

        <ConfigItem
          label={t("settings.voiceWakeWord")}
          description={t("settings.voiceWakeWordDesc")}
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
                  {t("settings.voiceListeningWake")}
                </span>
              </div>
            )}
            {wakeWordStatus === "triggered" && (
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping" />
                <span
                  className={`text-xs font-medium ${isDark ? "text-blue-400" : "text-blue-600"}`}
                >
                  {t("settings.voiceTriggered", { word: wakeWordTriggered })}
                </span>
              </div>
            )}
            {wakeWordStatus === "recording" && (
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span
                  className={`text-xs ${isDark ? "text-red-400" : "text-red-600"}`}
                >
                  {t("settings.voiceInputActive")}
                  {wakeWordTriggered
                    ? t("settings.voiceTriggeredBy", {
                        word: wakeWordTriggered,
                      })
                    : ""}
                </span>
              </div>
            )}
            {wakeWordStatus === "idle" && (
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-400" />
                <span
                  className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("settings.voiceWakeIdle")}
                </span>
              </div>
            )}

            {/* 唤醒词列表 */}
            <div>
              <label
                className={`block text-xs font-medium mb-1.5 ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                {t("settings.voiceTriggerList")}
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
                      title={t("common.remove")}
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
                  placeholder={t("settings.voiceTriggerPlaceholder")}
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
                  {t("settings.voiceAddTrigger")}
                </button>
              </div>
            </div>
          </div>
        )}

        <ConfigItem
          label={t("settings.voiceAutoPlayTts")}
          description={t("settings.voiceAutoPlayTtsDesc")}
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
          label={t("settings.voiceTtsVoice")}
          description={t("settings.voiceTtsVoiceDesc")}
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
              voiceLoading
                ? t("settings.voiceLoadingVoices")
                : t("settings.voicePlaceholder")
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
            {isProcessing ? t("settings.saving") : t("settings.saveSettings")}
          </button>
        </div>
      </div>
    </ConfigSection>
  );
}

export default VoiceSettings;
