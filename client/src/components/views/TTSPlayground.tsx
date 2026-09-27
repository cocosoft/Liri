import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import TTSHistoryItem, { type SynthesisHistoryItem } from "./TTSHistoryItem";
import { getBackendBaseUrl } from "../../services/backendUrl";

/**
 * TTSPlayground — 合成测试控制台组件
 *
 * 提供：文本输入、合成/停止/保存/复制按钮、音频播放器、合成历史列表。
 * 合成历史仅存元数据，无 base64 音频。
 */

/** TTSPlayground 组件 Props */
interface TTSPlaygroundProps {
  activeVoice: string;
  activeFormat: string;
  speed: number;
  /** 合成请求发送时的 Provider 名称（存历史用） */
  provider: string;
}

/** localStorage 键名 */
const HISTORY_KEY = "liri-tts-history";

/** 历史记录最大条数 */
const MAX_HISTORY = 100;

/** 输入字符上限 */
const MAX_INPUT_CHARS = 5000;

/**
 * 合成测试控制台
 *
 * @param activeVoice - 当前选中的语音 ID
 * @param activeFormat - 当前选中的音频格式
 * @param speed - 语速
 * @param provider - 当前选中的 TTS Provider
 */
function TTSPlayground({
  activeVoice,
  activeFormat,
  speed,
  provider,
}: TTSPlaygroundProps) {
  const { t } = useTranslation();
  // ── 状态 ──
  const [text, setText] = useState("");
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesisError, setSynthesisError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<SynthesisHistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const items: SynthesisHistoryItem[] = JSON.parse(raw);
      return Array.isArray(items) ? items.slice(-MAX_HISTORY) : [];
    } catch {
      return [];
    }
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  /** 合成耗时（请求发出 → audioUrl 可用），G6 感知延迟观测 */
  const [synthesisMs, setSynthesisMs] = useState<number | null>(null);

  // ── 保存历史 ──
  const saveHistory = useCallback((items: SynthesisHistoryItem[]): void => {
    try {
      const trimmed = items.slice(-MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
      setHistory(trimmed);
    } catch {
      // localStorage 配额不足时静默降级
    }
  }, []);

  // ── 合成 ──
  const handleSynthesize = useCallback(async () => {
    if (!text.trim() || synthesizing) return;

    setSynthesizing(true);
    setSynthesisError(null);
    setAudioUrl(null);
    setPlayError(null);
    setSynthesisMs(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const t0 = performance.now();

    try {
      const response = await fetch(`${getBackendBaseUrl()}/v1/voice/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          voiceId: activeVoice,
          format: activeFormat,
        }),
        signal: controller.signal,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error?.message ||
            result?.error ||
            t("tts.serverError", { status: response.status }),
        );
      }

      if (result.audioUrl) {
        setAudioUrl(result.audioUrl);
        setSynthesisMs(Math.round(performance.now() - t0));

        // 写入历史
        const item: SynthesisHistoryItem = {
          id: Date.now().toString(),
          text: text.trim(),
          charCount: text.trim().length,
          provider,
          voice: activeVoice,
          speed,
          createdAt: Date.now(),
          durationMs: Math.round(performance.now() - t0),
        };
        saveHistory([...history, item]);
      } else {
        throw new Error(result.error || t("tts.synthesisFailedShort"));
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setSynthesisError(
        err instanceof Error ? err.message : t("tts.synthesisFailedShort"),
      );
    } finally {
      setSynthesizing(false);
      abortRef.current = null;
    }
  }, [
    text,
    activeVoice,
    activeFormat,
    speed,
    provider,
    synthesizing,
    history,
    saveHistory,
    t,
  ]);

  // ── 停止合成 ──
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current.load();
    }
    setSynthesizing(false);
  }, []);

  // ── [再次合成]：回填文本到输入框 ──
  const handleReSynthesize = useCallback((item: SynthesisHistoryItem) => {
    setText(item.text);
  }, []);

  // ── 保存音频到文件 ──
  const handleSaveAudio = useCallback(() => {
    if (!audioUrl) return;
    const link = document.createElement("a");
    link.href = audioUrl;
    link.download = `tts_${Date.now()}.${activeFormat}`;
    link.click();
  }, [audioUrl, activeFormat]);

  // ── 复制文本 ──
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
  }, [text]);

  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
        {t("tts.synthesisTest")}
      </h3>

      {/* 文本输入 */}
      <textarea
        value={text}
        onChange={(e) => {
          if (e.target.value.length <= MAX_INPUT_CHARS) {
            setText(e.target.value);
          }
        }}
        placeholder={t("tts.inputPlaceholder")}
        rows={4}
        className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm resize-none mb-2"
      />
      <p className="text-xs text-gray-400 mb-3">
        {t("tts.charCount", {
          current: text.length,
          max: MAX_INPUT_CHARS,
        })}
      </p>

      {/* 操作按钮 */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={handleSynthesize}
          disabled={
            !text.trim() || synthesizing || text.length >= MAX_INPUT_CHARS
          }
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {synthesizing ? t("tts.synthesizing") : t("tts.synthesize")}
        </button>
        <button
          onClick={handleStop}
          disabled={!synthesizing}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded text-sm hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-50"
        >
          {t("tts.stop")}
        </button>
        <button
          onClick={handleSaveAudio}
          disabled={!audioUrl}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded text-sm hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-50"
        >
          {t("common.save")}
        </button>
        <button
          onClick={handleCopy}
          disabled={!text}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded text-sm hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-50"
        >
          {t("common.copy")}
        </button>
      </div>

      {/* 超限提示 */}
      {text.length >= MAX_INPUT_CHARS && (
        <p className="text-amber-600 text-xs mb-3">
          {t("tts.textTooLong", { max: MAX_INPUT_CHARS })}
        </p>
      )}

      {/* 合成失败错误提示 */}
      {synthesisError && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded text-sm mt-2 flex items-center justify-between mb-3">
          <span>{t("tts.synthesisFailed", { error: synthesisError })}</span>
          <button
            onClick={() => setSynthesisError(null)}
            className="underline text-sm whitespace-nowrap ml-2"
          >
            {t("common.close")}
          </button>
        </div>
      )}

      {/* 合成耗时（G6 感知延迟观测） */}
      {synthesisMs != null && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {t("tts.synthesisTime")}
          <span className="font-medium tabular-nums">{synthesisMs}ms</span>
          {synthesisMs <= 800 ? " ✓" : ""}
        </p>
      )}

      {/* 播放器 */}
      {audioUrl && (
        <div className="mb-3">
          <audio
            ref={audioRef}
            src={audioUrl}
            controls
            className="w-full"
            onError={() => setPlayError(t("tts.playError"))}
            onCanPlay={() => setPlayError(null)}
          />
          {playError && (
            <p className="text-red-600 dark:text-red-400 text-xs mt-1 flex items-center justify-between">
              <span>{t("tts.playFailed", { error: playError })}</span>
              <button
                onClick={() => setPlayError(null)}
                className="underline text-sm whitespace-nowrap ml-2"
              >
                {t("common.close")}
              </button>
            </p>
          )}
        </div>
      )}

      {/* 合成历史 */}
      {history.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t("tts.recentSynthesis")}
          </h4>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {[...history]
              .reverse()
              .slice(0, 20)
              .map((item) => (
                <TTSHistoryItem
                  key={item.id}
                  item={item}
                  onReSynthesize={handleReSynthesize}
                />
              ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default TTSPlayground;
