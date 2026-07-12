/**
 * 翻译页面
 *
 * 三栏布局：左侧翻译历史 → 中间输入 → 右侧输出
 * 类似聊天界面，历史记录常驻左侧，点击回填。
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { useTranslateStore } from "../../stores/translateStore";
import { translateService } from "../../services/translateService";

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

function TranslatePage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const {
    sourceText, sourceLang, targetLang, translatedText,
    isTranslating, isStreaming, error, canFallback, lastResult,
    history, historyTotal, historyPage, isLoadingHistory, searchQuery,
    setSourceText, setSourceLang, setTargetLang,
    swapLanguages, translate, abortTranslation, fallbackToNonStream,
    clearResult, loadHistory, setSearchQuery, toggleStar, deleteHistory,
  } = useTranslateStore();

  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);

  useEffect(() => { loadHistory(1); }, []);
  useEffect(() => { if (lastResult) loadHistory(1); }, [lastResult]);

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
    const m: Record<string, string> = {
      zh: "zh-CN", en: "en-US", ja: "ja-JP", ko: "ko-KR",
      fr: "fr-FR", de: "de-DE", es: "es-ES", pt: "pt-PT",
      ru: "ru-RU", ar: "ar-SA", th: "th-TH", vi: "vi-VN",
    };
    const u = new SpeechSynthesisUtterance(translatedText);
    u.lang = m[lastResult.targetLang] || lastResult.targetLang;
    u.onstart = () => setIsSpeaking(true);
    u.onend = () => setIsSpeaking(false);
    u.onerror = () => setIsSpeaking(false);
    speechSynthesis.speak(u);
  }, [translatedText, lastResult]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); translate(); }
  }, [translate]);

  const handleLoadMore = useCallback(() => loadHistory(historyPage + 1), [historyPage, loadHistory]);

  const getLangName = useCallback((code: string) => {
    const key = LANG_NAME_MAP[code]; return key ? t(key) : code;
  }, [t]);

  const detectedLangLabel = useMemo(() => {
    if (!lastResult || sourceLang !== "auto") return null;
    return lastResult.sourceLang;
  }, [lastResult, sourceLang]);

  const confidencePct = useMemo(() => {
    if (!lastResult?.confidence || sourceLang !== "auto") return null;
    return Math.round(lastResult.confidence * 100);
  }, [lastResult, sourceLang]);

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
  const errorBg = isDark ? "bg-red-900/30" : "bg-red-50";
  const errorText = isDark ? "text-red-400" : "text-red-600";
  const successBg = isDark ? "bg-green-900/30" : "bg-green-50";
  const successText = isDark ? "text-green-400" : "text-green-600";
  const borderColor = isDark ? "#374151" : "#e5e7eb";

  const charCount = sourceText.length;
  const hasSource = sourceText.trim().length > 0;
  const hasResult = translatedText.length > 0;
  const showTranslating = isTranslating && !hasResult;

  return (
    <div className={`flex flex-col flex-1 min-h-0 ${bgColor} ${textColor}`}>
      {/* ════ 语言选择栏 ════ */}
      <div className="flex items-center gap-4 px-4 pt-3 pb-2 border-b flex-shrink-0" style={{ borderColor }}>
        <div className="flex flex-col gap-1">
          <label className={`text-xs font-medium ${mutedColor}`}>{t("translate.sourceLanguage")}</label>
          <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}
            disabled={isTranslating}
            className={`px-3 py-1.5 rounded-lg border text-sm outline-none ${selectBg} ${inputBorder} ${textColor} disabled:opacity-50`}>
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
            className={`px-3 py-1.5 rounded-lg border text-sm outline-none ${selectBg} ${inputBorder} ${textColor} disabled:opacity-50`}>
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

        {isTranslating ? (
          <button onClick={abortTranslation} className={`px-5 py-2 rounded-lg text-sm font-medium border-0 cursor-pointer transition-colors ${btnDanger}`}>
            {t("translate.cancel")}
          </button>
        ) : (
          <button onClick={() => translate()} disabled={!hasSource}
            className={`px-5 py-2 rounded-lg text-sm font-medium border-0 cursor-pointer transition-colors ${btnPrimary} disabled:opacity-50 disabled:cursor-not-allowed`}>
            {t("translate.translate")}
          </button>
        )}
      </div>

      {/* ════ 错误 + 降级 ════ */}
      {error && (
        <div className={`mx-4 mt-2 px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${errorBg} ${errorText}`}>
          <span className="flex-1">{error}</span>
          {canFallback && (
            <button onClick={() => fallbackToNonStream()}
              className="px-2 py-0.5 rounded text-xs border-0 cursor-pointer bg-blue-600/20 text-blue-400 hover:bg-blue-600/30">
              {t("translate.fallback")}
            </button>
          )}
        </div>
      )}

      {/* ════ 三栏主区域 ════ */}
      <div className="flex-1 flex min-h-0">

        {/* ── 左侧：翻译历史 ── */}
        <div className={`flex-shrink-0 border-r flex flex-col ${historyCollapsed ? "w-0 overflow-hidden" : "w-60"}`}
          style={{ borderColor }}>
          {/* 标题栏 */}
          <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor }}>
            <h3 className={`text-sm font-medium flex-1 ${textColor}`}>{t("translate.history")}</h3>
            {historyTotal > 0 && <span className={`text-xs ${mutedColor}`}>({historyTotal})</span>}
            <button onClick={() => setHistoryCollapsed(true)}
              className={`text-xs border-0 cursor-pointer bg-transparent ${mutedColor} hover:${textColor}`}
              title={t("translate.collapse")}>◀</button>
          </div>

          {/* 搜索栏 */}
          <div className="px-2 py-1.5">
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("translate.searchHistory")}
              className={`w-full px-2 py-1 rounded text-xs border outline-none ${inputBg} ${inputBorder} ${textColor}`} />
          </div>

          {/* 列表 */}
          <div className="flex-1 overflow-y-auto">
            {isLoadingHistory && history.length === 0 ? (
              <div className={`px-3 py-4 text-xs ${mutedColor}`}>{t("common.loading")}</div>
            ) : history.length === 0 ? (
              <div className={`px-3 py-4 text-xs ${mutedColor}`}>{t("translate.noHistory")}</div>
            ) : (
              <>
                {history.map((item) => (
                  <div key={item.id}
                    className={`px-3 py-2 border-t cursor-pointer transition-colors hover:bg-opacity-50 ${panelBg}`}
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
                    <div className={`text-xs mt-1 truncate ${textColor}`}>{item.sourceText}</div>
                    <div className={`text-xs truncate ${mutedColor}`}>{item.translatedText}</div>
                  </div>
                ))}
                {history.length < historyTotal && (
                  <div className="px-3 py-2 text-center">
                    <button onClick={handleLoadMore} disabled={isLoadingHistory}
                      className={`px-3 py-1 rounded text-xs border-0 cursor-pointer ${btnSecondary} disabled:opacity-50`}>
                      {isLoadingHistory ? t("common.loading") : "加载更多"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 底部操作：导出 */}
          {!historyCollapsed && history.length > 0 && (
            <div className="px-2 py-1.5 border-t" style={{ borderColor }}>
              <button onClick={() => {
                translateService.exportJSON().then((data) => {
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url;
                  a.download = "translate-history.json"; a.click();
                  URL.revokeObjectURL(url);
                });
              }}
                className={`w-full px-2 py-1 rounded text-xs border-0 cursor-pointer ${btnSecondary}`}>
                {t("translate.export")}
              </button>
            </div>
          )}
        </div>

        {/* ── 收起时的展开按钮 ── */}
        {historyCollapsed && (
          <button onClick={() => setHistoryCollapsed(false)}
            className={`flex-shrink-0 w-5 border-r border-0 cursor-pointer bg-transparent ${mutedColor} hover:${textColor} flex items-center justify-center text-xs`}
            style={{ borderColor }}
            title={t("translate.history")}>▶</button>
        )}

        {/* ── 中间：输入区 + ── */}
        <div className="flex-1 flex flex-col min-w-0 p-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className={`text-xs font-medium ${mutedColor}`}>{t("translate.sourceText")}</label>
            <span className={`text-xs ${mutedColor}`}>{t("translate.charCount", { count: charCount })}</span>
          </div>
          <textarea value={sourceText} onChange={(e) => setSourceText(e.target.value)}
            onKeyDown={handleKeyDown} placeholder={t("translate.placeholder")} disabled={isTranslating}
            className={`flex-1 w-full resize-none rounded-lg border p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500/50 ${inputBg} ${inputBorder} ${textColor} placeholder:${mutedColor} disabled:opacity-50`} />
          <span className={`text-xs mt-1 ${mutedColor}`}>Ctrl + Enter</span>
        </div>

        {/* ── 右侧：输出区 ── */}
        <div className="flex-1 flex flex-col min-w-0 p-4">
          <label className={`text-xs font-medium mb-1.5 ${mutedColor}`}>{t("translate.targetText")}</label>
          <div className={`flex-1 w-full rounded-lg border p-4 text-sm overflow-auto whitespace-pre-wrap ${inputBg} ${inputBorder} ${textColor}`}>
            {showTranslating && isStreaming ? (
              <span>{translatedText}<span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" /></span>
            ) : showTranslating ? (
              <span className={mutedColor}>{t("translate.translating")}</span>
            ) : hasResult ? (
              translatedText
            ) : (
              <span className={mutedColor}>{t("translate.resultPlaceholder")}</span>
            )}
          </div>

          {hasResult && !isTranslating && (
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={handleSpeak}
                disabled={isSpeaking || !("speechSynthesis" in window)}
                className={`px-3 py-1.5 rounded-lg text-sm border-0 cursor-pointer transition-colors ${isSpeaking ? successBg + " " + successText : btnSecondary} disabled:opacity-50 disabled:cursor-not-allowed`}
                title={t("translate.speak")}>{isSpeaking ? "🔊" : "🔈"}</button>
              <button onClick={handleCopy}
                className={`px-3 py-1.5 rounded-lg text-sm border-0 cursor-pointer transition-colors ${copied ? successBg + " " + successText : btnSecondary}`}>
                {copied ? "已复制" : t("translate.copy")}</button>
              <button onClick={clearResult}
                className={`px-3 py-1.5 rounded-lg text-sm border-0 cursor-pointer transition-colors ${btnSecondary}`}>
                {t("translate.clear")}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TranslatePage;
