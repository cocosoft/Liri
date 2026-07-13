/**
 * 翻译页面
 *
 * 三栏布局：左侧翻译历史 → 中间输入 → 右侧输出
 * 类似聊天界面，历史记录常驻左侧，点击回填。
 * 支持语音输入（webkitSpeechRecognition）、输入即翻（debounce）、TTS 语速控制、
 * 词汇备选翻译、对照模式、分享、识图翻译。
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { useTranslateStore } from "../../stores/translateStore";
import { translateService } from "../../services/translateService";
import type { AlternativeTranslation } from "../../services/translateService";
import { imageService } from "../../services/imageService";
import SplitText from "./SplitText";
import AlternativesPopover from "./AlternativesPopover";

// 浏览器 SpeechRecognition API 类型声明（非标准 API，手动补充）
declare class SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

const LANG_NAME_MAP: Record<string, string> = {
  auto: "translate.autoDetect", zh: "translate.langZh", en: "translate.langEn",
  ja: "translate.langJa", ko: "translate.langKo", fr: "translate.langFr",
  de: "translate.langDe", es: "translate.langEs", pt: "translate.langPt",
  ru: "translate.langRu", ar: "translate.langAr", th: "translate.langTh",
  vi: "translate.langVi",
};

const LANGUAGES = [
  { code: "auto", labelKey: "translate.autoDetect" },
  { code: "zh", labelKey: "translate.langZh" },
  { code: "en", labelKey: "translate.langEn" },
  { code: "ja", labelKey: "translate.langJa" },
  { code: "ko", labelKey: "translate.langKo" },
  { code: "fr", labelKey: "translate.langFr" },
  { code: "de", labelKey: "translate.langDe" },
  { code: "es", labelKey: "translate.langEs" },
  { code: "pt", labelKey: "translate.langPt" },
  { code: "ru", labelKey: "translate.langRu" },
  { code: "ar", labelKey: "translate.langAr" },
  { code: "th", labelKey: "translate.langTh" },
  { code: "vi", labelKey: "translate.langVi" },
];

/** speechRecognition lang 映射 */
const SPEECH_LANG_MAP: Record<string, string> = {
  zh: "zh-CN", en: "en-US", ja: "ja-JP", ko: "ko-KR",
  fr: "fr-FR", de: "de-DE", es: "es-ES", pt: "pt-PT",
  ru: "ru-RU", ar: "ar-SA", th: "th-TH", vi: "vi-VN",
};

/** TTS locale 映射 */
const TTS_LANG_MAP: Record<string, string> = {
  zh: "zh-CN", en: "en-US", ja: "ja-JP", ko: "ko-KR",
  fr: "fr-FR", de: "de-DE", es: "es-ES", pt: "pt-PT",
  ru: "ru-RU", ar: "ar-SA", th: "th-TH", vi: "vi-VN",
};

/** 实时翻译防抖延迟（毫秒） */
const AUTO_TRANSLATE_DEBOUNCE = 500;

/** 语音识别支持检测 */
const speechSupported: boolean =
  typeof window !== "undefined" &&
  ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

/** 支持的图片 MIME 类型 */
const IMAGE_MIME_TYPES: string[] = [
  "image/png", "image/jpeg", "image/webp", "image/bmp", "image/tiff",
];

/** 按段落拆分文本 */
function splitByParagraph(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function TranslatePage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const {
    sourceText, sourceLang, targetLang, translatedText,
    isTranslating, isStreaming, autoTranslateMode, compareMode, error, canFallback, lastResult,
    history, historyTotal, historyPage, isLoadingHistory, searchQuery,
    setSourceText, setSourceLang, setTargetLang,
    swapLanguages, translate, abortTranslation, fallbackToNonStream,
    clearResult, loadHistory, setSearchQuery, toggleStar, deleteHistory,
    toggleAutoTranslate, toggleCompareMode,
  } = useTranslateStore();

  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);

  // 语音输入
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // 语速控制
  const [speechRate, setSpeechRate] = useState(1.0);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);

  // 备选翻译
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<AlternativeTranslation[]>([]);
  const [altsLoading, setAltsLoading] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);

  // 分享菜单
  const [shareMenuOpen, setShareMenuOpen] = useState(false);

  // 识图翻译
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 实时翻译防抖计时器
  const autoTranslateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTranslatedTextRef = useRef<string>("");

  useEffect(() => { loadHistory(1); }, []);
  useEffect(() => { if (lastResult) loadHistory(1); }, [lastResult]);

  // ── 实时翻译：监听 sourceText 变化，500ms 防抖触发 ──
  useEffect(() => {
    if (!autoTranslateMode) return;
    const text = sourceText.trim();
    if (text.length < 2) return;
    if (text === lastTranslatedTextRef.current) return;

    if (autoTranslateTimerRef.current) {
      clearTimeout(autoTranslateTimerRef.current);
    }

    autoTranslateTimerRef.current = setTimeout(() => {
      lastTranslatedTextRef.current = text;
      translate();
    }, AUTO_TRANSLATE_DEBOUNCE);

    return () => {
      if (autoTranslateTimerRef.current) {
        clearTimeout(autoTranslateTimerRef.current);
      }
    };
  }, [sourceText, sourceLang, targetLang, autoTranslateMode, translate]);

  // ── 语音输入 ──
  const handleVoiceInput = useCallback(() => {
    if (!speechSupported) return;

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = sourceLang === "auto"
      ? (SPEECH_LANG_MAP[targetLang] || "en-US")
      : (SPEECH_LANG_MAP[sourceLang] || sourceLang);
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join("");
      const currentText = useTranslateStore.getState().sourceText;
      setSourceText(currentText + transcript);
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, sourceLang, targetLang, setSourceText]);

  // 清理语音识别
  useEffect(() => {
    return () => { recognitionRef.current?.abort(); };
  }, []);

  // ── handlers ──
  const handleCopy = useCallback(async () => {
    if (!translatedText) return;
    try {
      await navigator.clipboard.writeText(translatedText);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = translatedText; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    }
  }, [translatedText]);

  const handleSpeak = useCallback(() => {
    if (!translatedText || !lastResult) return;
    const u = new SpeechSynthesisUtterance(translatedText);
    u.lang = TTS_LANG_MAP[lastResult.targetLang] || lastResult.targetLang;
    u.rate = speechRate;
    u.onstart = () => setIsSpeaking(true);
    u.onend = () => setIsSpeaking(false);
    u.onerror = () => setIsSpeaking(false);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }, [translatedText, lastResult, speechRate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); translate(); }
  }, [translate]);

  // ── 识图翻译：上传图片 → OCR → 填入原文并触发翻译 ──
  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!IMAGE_MIME_TYPES.includes(file.type)) return;

    setOcrProcessing(true);

    try {
      // Step 1: 上传图片到后端
      const { path } = await imageService.upload(file);

      // Step 2: 调用 OCR 提取文字
      const result = await imageService.analyze(path, "ocr");

      const ocrText = result.text;
      if (ocrText && ocrText.trim()) {
        setSourceText(ocrText.trim());
      }
    } catch {
      // OCR 失败，静默处理
    } finally {
      setOcrProcessing(false);
      // 重置 file input 以允许重复上传同一文件
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [setSourceText]);

  // ── 备选翻译：点击词 → 弹出 popover ──
  const handleWordClick = useCallback(async (word: string, event: React.MouseEvent) => {
    if (!lastResult) return;

    if (selectedWord === word) {
      setSelectedWord(null);
      setAlternatives([]);
      setPopoverPos(null);
      return;
    }

    setSelectedWord(word);
    setAlternatives([]);
    setAltsLoading(true);
    setPopoverPos({ x: event.clientX, y: event.clientY });

    try {
      const result = await translateService.getAlternatives({
        word,
        sourceLang: lastResult.sourceLang,
        targetLang: lastResult.targetLang,
        context: lastResult.sourceText,
      });
      setAlternatives(result.alternatives);
    } catch {
      setAlternatives([]);
    } finally {
      setAltsLoading(false);
    }
  }, [lastResult, selectedWord]);

  // ── 备选翻译：选中替换 ──
  const handleSelectAlternative = useCallback((translation: string) => {
    if (!selectedWord) return;
    const escaped = selectedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const replaced = translatedText.replace(new RegExp(`\\b${escaped}\\b`, 'u'), translation);
    if (replaced !== translatedText) {
      useTranslateStore.setState({ translatedText: replaced });
    }
    setSelectedWord(null);
    setAlternatives([]);
    setPopoverPos(null);
  }, [selectedWord, translatedText]);

  const handleCloseAlternatives = useCallback(() => {
    setSelectedWord(null);
    setAlternatives([]);
    setPopoverPos(null);
  }, []);

  // ── 分享 ──
  const handleShareCopyText = useCallback(async () => {
    if (!lastResult) return;
    const sourceLabel = getLangName(lastResult.sourceLang);
    const targetLabel = getLangName(lastResult.targetLang);
    const text = t("translate.shareResult", {
      source: sourceLabel,
      target: targetLabel,
      sourceText: lastResult.sourceText,
      translatedText: lastResult.translatedText,
    }).replace(/\\n/g, "\n");

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setShareMenuOpen(false);
  }, [lastResult, t]);

  const handleShareCopyLink = useCallback(async () => {
    if (!lastResult) return;
    const params = new URLSearchParams({
      text: lastResult.sourceText,
      from: lastResult.sourceLang,
      to: lastResult.targetLang,
    });
    const url = `${window.location.origin}/translate?${params.toString()}`;

    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setShareMenuOpen(false);
  }, [lastResult]);

  const getLangName = useCallback((code: string) => {
    const key = LANG_NAME_MAP[code]; return key ? t(key) : code;
  }, [t]);

  const handleLoadMore = useCallback(() => loadHistory(historyPage + 1), [historyPage, loadHistory]);

  const detectedLangLabel = useMemo(() => {
    if (!lastResult || sourceLang !== "auto") return null;
    return lastResult.sourceLang;
  }, [lastResult, sourceLang]);

  const confidencePct = useMemo(() => {
    if (!lastResult?.confidence || sourceLang !== "auto") return null;
    return Math.round(lastResult.confidence * 100);
  }, [lastResult, sourceLang]);

  // ── 对照模式段落数据 ──
  const compareParagraphs = useMemo(() => {
    if (!sourceText || !translatedText) return [];
    const srcPars = splitByParagraph(sourceText);
    const tgtPars = splitByParagraph(translatedText);
    const maxLen = Math.max(srcPars.length, tgtPars.length);
    const result: Array<{ source: string; target: string }> = [];
    for (let i = 0; i < maxLen; i++) {
      result.push({
        source: srcPars[i] || "",
        target: tgtPars[i] || "",
      });
    }
    return result;
  }, [sourceText, translatedText]);

  // ── 主题 ──
  const bgColor = isDark ? "bg-gray-900" : "bg-white";
  const textColor = isDark ? "text-gray-300" : "text-gray-700";
  const mutedColor = isDark ? "text-gray-500" : "text-gray-400";
  const inputBg = isDark ? "bg-gray-800" : "bg-gray-50";
  const inputBorder = isDark ? "border-gray-700" : "border-gray-200";
  const selectBg = isDark ? "bg-gray-800" : "bg-white";
  const panelBg = isDark ? "bg-gray-800/40" : "bg-gray-50";
  const btnPrimary = "bg-blue-600 hover:bg-blue-700 text-white";
  const btnDanger = "bg-red-600 hover:bg-red-700 text-white";
  const btnSecondary = isDark ? "bg-gray-700 hover:bg-gray-600 text-gray-300" : "bg-gray-200 hover:bg-gray-300 text-gray-700";
  const btnGhost = "bg-transparent hover:bg-gray-200/50 dark:hover:bg-gray-700/50";
  const errorBg = isDark ? "bg-red-900/30" : "bg-red-50";
  const errorText = isDark ? "text-red-400" : "text-red-600";
  const successBg = isDark ? "bg-green-900/30" : "bg-green-50";
  const successText = isDark ? "text-green-400" : "text-green-600";
  const borderColor = isDark ? "#374151" : "#e5e7eb";
  const micActiveBg = "bg-red-500 hover:bg-red-600 text-white";
  const compareHover = isDark ? "hover:bg-gray-700/50" : "hover:bg-gray-100";

  const charCount = sourceText.length;
  const hasSource = sourceText.trim().length > 0;
  const hasResult = translatedText.length > 0;
  const showTranslating = isTranslating && !hasResult;

  /** 语速选项 */
  const SPEED_OPTIONS = [
    { rate: 1.0, label: t("translate.speechNormal") },
    { rate: 0.75, label: t("translate.speechSlow") },
    { rate: 0.5, label: t("translate.speechSlower") },
  ];

  return (
    <div className={`flex flex-col flex-1 min-h-0 ${bgColor} ${textColor}`}>
      {/* ════ 语言选择栏 ════ */}
      <div className="flex items-center gap-3 px-5 pt-3 pb-3 border-b flex-shrink-0" style={{ borderColor }}>
        <div className="flex flex-col gap-1">
          <label className={`text-xs font-medium ${mutedColor}`}>{t("translate.sourceLanguage")}</label>
          <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}
            disabled={isTranslating}
            className={`px-3 py-2 rounded-xl border text-sm outline-none ${selectBg} ${inputBorder} ${textColor} disabled:opacity-50`}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.code === "auto" ? t("translate.autoDetect") : t(l.labelKey)}</option>
            ))}
          </select>
        </div>

        <button onClick={swapLanguages} disabled={sourceLang === "auto" || isTranslating}
          className={`flex-shrink-0 w-10 h-10 rounded-full border-0 cursor-pointer transition-all flex items-center justify-center text-lg mt-4 ${btnSecondary} disabled:opacity-30 disabled:cursor-not-allowed hover:scale-110`}
          title={t("translate.swap")}>⇄</button>

        <div className="flex flex-col gap-1">
          <label className={`text-xs font-medium ${mutedColor}`}>{t("translate.targetLanguage")}</label>
          <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}
            disabled={isTranslating}
            className={`px-3 py-2 rounded-xl border text-sm outline-none ${selectBg} ${inputBorder} ${textColor} disabled:opacity-50`}>
            {LANGUAGES.filter((l) => l.code !== "auto").map((l) => (
              <option key={l.code} value={l.code}>{t(l.labelKey)}</option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        {detectedLangLabel && (
          <span className={`text-xs ${mutedColor}`}>
            {t("translate.detectedAs", { lang: getLangName(detectedLangLabel) })}
            {confidencePct !== null && ` (${confidencePct}%)`}
          </span>
        )}

        {/* 对照模式切换 */}
        <button onClick={toggleCompareMode}
          className={`flex-shrink-0 w-8 h-8 rounded-full border-0 cursor-pointer transition-all flex items-center justify-center text-sm ${compareMode ? "bg-blue-600 text-white" : btnSecondary}`}
          title={t("translate.compareMode")}>
          ☰
        </button>

        {/* 实时翻译开关 */}
        <button onClick={toggleAutoTranslate}
          className={`flex-shrink-0 w-8 h-8 rounded-full border-0 cursor-pointer transition-all flex items-center justify-center text-sm ${autoTranslateMode ? "bg-blue-600 text-white" : btnSecondary}`}
          title={t("translate.autoTranslate")}>
          ⚡
        </button>

        {isTranslating ? (
          <button onClick={abortTranslation} className={`px-5 py-2 rounded-xl text-sm font-medium border-0 cursor-pointer transition-all duration-200 ${btnDanger}`}>
            {t("translate.cancel")}
          </button>
        ) : (
          <button onClick={() => translate()} disabled={!hasSource}
            className={`px-5 py-2 rounded-xl text-sm font-medium border-0 cursor-pointer transition-all duration-200 ${btnPrimary} disabled:opacity-50 disabled:cursor-not-allowed`}>
            {t("translate.translate")}
          </button>
        )}
      </div>

      {/* ════ 错误 + 降级 ════ */}
      {error && (
        <div className={`mx-5 mt-3 px-4 py-3 rounded-xl text-sm flex items-center gap-2 ${errorBg} ${errorText}`}>
          <span className="flex-1">{error}</span>
          {canFallback && (
            <button onClick={() => fallbackToNonStream()}
              className="px-2 py-0.5 rounded-lg text-xs border-0 cursor-pointer bg-blue-600/20 text-blue-400 hover:bg-blue-600/30">
              {t("translate.fallback")}
            </button>
          )}
        </div>
      )}

      {/* ════ 三栏主区域 ════ */}
      <div className="flex-1 flex min-h-0">

        {/* ── 左侧：翻译历史 ── */}
        <div className={`flex-shrink-0 border-r flex flex-col ${historyCollapsed ? "w-0 overflow-hidden" : "w-64"}`}
          style={{ borderColor }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor }}>
            <h3 className={`text-sm font-semibold flex-1 ${textColor}`}>{t("translate.history")}</h3>
            {historyTotal > 0 && <span className={`text-xs ${mutedColor}`}>({historyTotal})</span>}
            <button onClick={() => setHistoryCollapsed(true)}
              className={`text-xs border-0 cursor-pointer bg-transparent ${mutedColor} hover:${textColor}`}
              title={t("translate.collapse")}>◀</button>
          </div>

          <div className="px-3 py-2">
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("translate.searchHistory")}
              className={`w-full px-3 py-1.5 rounded-lg text-xs border outline-none ${inputBg} ${inputBorder} ${textColor}`} />
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoadingHistory && history.length === 0 ? (
              <div className={`px-4 py-5 text-xs ${mutedColor}`}>{t("common.loading")}</div>
            ) : history.length === 0 ? (
              <div className={`px-4 py-5 text-xs ${mutedColor}`}>{t("translate.noHistory")}</div>
            ) : (
              <>
                {history.map((item) => (
                  <div key={item.id}
                    className={`px-4 py-3 border-t cursor-pointer transition-colors ${panelBg}`}
                    style={{ borderColor }}
                    onClick={() => { setSourceText(item.sourceText); setSourceLang(item.sourceLang); setTargetLang(item.targetLang); }}>
                    <div className="flex items-center gap-1 text-xs">
                      <span className={`${mutedColor} truncate`}>{getLangName(item.sourceLang)}</span>
                      <span className={mutedColor}>→</span>
                      <span className={`${mutedColor} truncate`}>{getLangName(item.targetLang)}</span>
                      {item.starred && <span className="text-yellow-400 flex-shrink-0">★</span>}
                      <span className="flex-1" />
                      <button onClick={(e) => { e.stopPropagation(); toggleStar(item.id); }}
                        className={`text-xs border-0 cursor-pointer bg-transparent flex-shrink-0 ${item.starred ? "text-yellow-400" : mutedColor}`}
                        title={item.starred ? t("translate.unstar") : t("translate.star")}>
                        {item.starred ? "★" : "☆"}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); deleteHistory([item.id]); }}
                        className={`text-xs border-0 cursor-pointer bg-transparent flex-shrink-0 ${mutedColor} hover:text-red-400`}
                        title={t("translate.delete")}>✕</button>
                    </div>
                    <div className={`text-xs mt-1.5 truncate leading-relaxed ${textColor}`}>{item.sourceText}</div>
                    <div className={`text-xs truncate leading-relaxed ${mutedColor}`}>{item.translatedText}</div>
                  </div>
                ))}
                {history.length < historyTotal && (
                  <div className="px-4 py-3 text-center">
                    <button onClick={handleLoadMore} disabled={isLoadingHistory}
                      className={`px-4 py-1.5 rounded-lg text-xs border-0 cursor-pointer ${btnSecondary} disabled:opacity-50`}>
                      {isLoadingHistory ? t("common.loading") : "加载更多"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {!historyCollapsed && history.length > 0 && (
            <div className="px-3 py-2 border-t" style={{ borderColor }}>
              <button onClick={() => {
                translateService.exportJSON().then((data) => {
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url;
                  a.download = "translate-history.json"; a.click();
                  URL.revokeObjectURL(url);
                });
              }}
                className={`w-full px-3 py-1.5 rounded-lg text-xs border-0 cursor-pointer ${btnSecondary}`}>
                {t("translate.export")}
              </button>
            </div>
          )}
        </div>

        {historyCollapsed && (
          <button onClick={() => setHistoryCollapsed(false)}
            className={`flex-shrink-0 w-6 border-r border-0 cursor-pointer bg-transparent ${mutedColor} hover:${textColor} flex items-center justify-center text-xs`}
            style={{ borderColor }}
            title={t("translate.history")}>▶</button>
        )}

        {/* ── 中间：输入区 ── */}
        <div className="flex-1 flex flex-col min-w-0 p-5">
          <div className="flex items-center justify-between mb-2">
            <label className={`text-xs font-medium ${mutedColor}`}>{t("translate.sourceText")}</label>
            <span className={`text-xs ${mutedColor}`}>{t("translate.charCount", { count: charCount })}</span>
          </div>
          {/* OCR 处理中蒙层 */}
          <div className="relative flex-1">
            <textarea value={sourceText} onChange={(e) => setSourceText(e.target.value)}
              onKeyDown={handleKeyDown} placeholder={t("translate.placeholder")} disabled={isTranslating || ocrProcessing}
              className={`w-full h-full resize-none rounded-xl border p-5 text-base leading-relaxed outline-none focus:ring-2 focus:ring-blue-500/50 ${inputBg} ${inputBorder} ${textColor} placeholder:${mutedColor} disabled:opacity-50`} />
            {ocrProcessing && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/20">
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900/80 text-white text-sm">
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {t("translate.ocrProcessing")}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1">
              {speechSupported ? (
                <button onClick={handleVoiceInput}
                  className={`flex-shrink-0 w-8 h-8 rounded-full border-0 cursor-pointer transition-all flex items-center justify-center text-xs ${isListening ? `${micActiveBg} animate-pulse` : `${btnGhost} ${mutedColor}`}`}
                  title={isListening ? t("translate.listening") : t("translate.speak")}>
                  {isListening ? "⏹" : "🎤"}
                </button>
              ) : (
                <button disabled
                  className={`flex-shrink-0 w-8 h-8 rounded-full border-0 flex items-center justify-center text-xs opacity-30 ${mutedColor}`}
                  title={t("translate.voiceNotSupported")}>🎤</button>
              )}
              {/* 识图翻译：上传图片 OCR */}
              <button onClick={() => fileInputRef.current?.click()}
                disabled={ocrProcessing || isTranslating}
                className={`flex-shrink-0 w-8 h-8 rounded-full border-0 cursor-pointer transition-all flex items-center justify-center text-xs ${ocrProcessing ? "bg-blue-600 text-white animate-pulse" : `${btnGhost} ${mutedColor}`}`}
                title={t("translate.imageTranslate")}>
                {ocrProcessing ? "⏳" : "📷"}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*"
                onChange={handleImageUpload} className="hidden" />
            </div>
            <span className={`text-xs ${mutedColor}`}>Ctrl + Enter</span>
          </div>
        </div>

        {/* ── 右侧：输出区 ── */}
        <div className="flex-1 flex flex-col min-w-0 p-5">
          {/* 输出区头部：模式切换 + 操作 */}
          <div className="flex items-center justify-between mb-2">
            <label className={`text-xs font-medium ${mutedColor}`}>{t("translate.targetText")}</label>
            {hasResult && !isTranslating && (
              <div className="flex items-center gap-1">
                {/* 分享 */}
                <div className="relative">
                  <button onClick={() => setShareMenuOpen(!shareMenuOpen)}
                    className={`w-7 h-7 rounded-lg border-0 cursor-pointer transition-colors flex items-center justify-center text-xs ${btnGhost} ${mutedColor}`}
                    title={t("translate.share")}>↗</button>
                  {shareMenuOpen && (
                    <div className={`absolute right-0 top-full mt-1 rounded-xl border shadow-xl py-1.5 z-10 min-w-[130px] ${selectBg} ${inputBorder}`}>
                      <button onClick={handleShareCopyText}
                        className={`block w-full px-4 py-1.5 text-left text-xs border-0 cursor-pointer whitespace-nowrap ${btnGhost} ${textColor}`}>
                        {t("translate.shareCopyText")}
                      </button>
                      <button onClick={handleShareCopyLink}
                        className={`block w-full px-4 py-1.5 text-left text-xs border-0 cursor-pointer whitespace-nowrap ${btnGhost} ${textColor}`}>
                        {t("translate.shareCopyLink")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 输出内容 */}
          {compareMode && hasResult && !isTranslating ? (
            /* ════ 对照模式 ════ */
            <div className={`flex-1 w-full rounded-xl border overflow-auto ${inputBg} ${inputBorder} ${textColor}`}>
              {compareParagraphs.map((para, idx) => (
                <div key={idx}
                  className={`px-5 py-3 transition-colors ${compareHover}`}
                  style={{ borderBottom: idx < compareParagraphs.length - 1 ? `1px solid ${borderColor}` : "none" }}>
                  <div className={`text-sm leading-relaxed mb-1.5 ${mutedColor}`}>
                    {para.source || <span className="italic opacity-50">—</span>}
                  </div>
                  <div className="text-sm leading-relaxed">
                    {para.target || <span className="italic opacity-50">—</span>}
                  </div>
                </div>
              ))}
              {compareParagraphs.length === 0 && (
                <div className={`px-5 py-4 text-sm ${mutedColor}`}>{t("translate.resultPlaceholder")}</div>
              )}
            </div>
          ) : (
            /* ════ 仅译文模式 ════ */
            <div className={`flex-1 w-full rounded-xl border p-5 text-base leading-relaxed overflow-auto whitespace-pre-wrap ${inputBg} ${inputBorder} ${textColor}`}>
              {showTranslating && isStreaming ? (
                <span>{translatedText}<span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" /></span>
              ) : showTranslating ? (
                <span className={mutedColor}>{t("translate.translating")}</span>
              ) : hasResult ? (
                <SplitText text={translatedText} isDark={isDark} onWordClick={handleWordClick} />
              ) : (
                <span className={mutedColor}>{t("translate.resultPlaceholder")}</span>
              )}
            </div>
          )}

          {/* 底部操作栏 */}
          {hasResult && !isTranslating && (
            <div className="flex justify-end items-center gap-2 mt-3">
              {/* 语速选择 */}
              <div className="relative">
                <button onClick={handleSpeak}
                  disabled={isSpeaking || !("speechSynthesis" in window)}
                  className={`w-9 h-9 rounded-xl text-sm border-0 cursor-pointer transition-colors flex items-center justify-center ${isSpeaking ? successBg + " " + successText : btnSecondary} disabled:opacity-50 disabled:cursor-not-allowed`}
                  title={t("translate.speak")}>{isSpeaking ? "🔊" : "🔈"}</button>
                <button onClick={() => setSpeedMenuOpen(!speedMenuOpen)}
                  className={`ml-1 px-1.5 py-1 rounded-lg text-xs border-0 cursor-pointer ${btnSecondary}`}
                  title={t("translate.speechRate")}>
                  {speechRate === 1.0 ? "1x" : speechRate === 0.75 ? "0.75x" : "0.5x"}
                </button>
                {speedMenuOpen && (
                  <div className={`absolute bottom-full right-0 mb-1 rounded-xl border shadow-lg py-1 z-10 ${selectBg} ${inputBorder}`}>
                    {SPEED_OPTIONS.map((opt) => (
                      <button key={opt.rate}
                        onClick={() => { setSpeechRate(opt.rate); setSpeedMenuOpen(false); }}
                        className={`block w-full px-4 py-1.5 text-left text-xs border-0 cursor-pointer whitespace-nowrap ${speechRate === opt.rate ? "bg-blue-600 text-white" : `${btnGhost} ${textColor}`}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={handleCopy}
                className={`w-9 h-9 rounded-xl text-sm border-0 cursor-pointer transition-colors flex items-center justify-center ${copied ? successBg + " " + successText : btnSecondary}`}
                title={t("translate.copy")}>
                {copied ? "✓" : "📋"}
              </button>
              <button onClick={clearResult}
                className={`w-9 h-9 rounded-xl text-sm border-0 cursor-pointer transition-colors flex items-center justify-center ${btnSecondary}`}
                title={t("translate.clear")}>✕</button>
            </div>
          )}
        </div>
      </div>

      {/* ── 备选翻译弹窗 ── */}
      <AlternativesPopover
        word={selectedWord || ""}
        alternatives={alternatives}
        loading={altsLoading}
        position={popoverPos}
        isDark={isDark}
        onSelect={handleSelectAlternative}
        onClose={handleCloseAlternatives}
      />
    </div>
  );
}

export default TranslatePage;
