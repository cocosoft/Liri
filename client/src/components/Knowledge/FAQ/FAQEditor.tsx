import { useState, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import type { FAQEntry } from "../../../types/knowledge";
import { X, Eye, Edit3 } from "lucide-react";

interface FAQEditorProps {
  isDark: boolean;
  entry?: FAQEntry; // undefined = 创建模式
  onSave: (data: {
    question: string;
    answer: string;
    similarQuestions: string[];
    tags: string[];
    category: string;
    recommended: boolean;
  }) => Promise<void>;
  onClose: () => void;
}

export const FAQEditor = memo(function FAQEditor({
  isDark,
  entry,
  onSave,
  onClose,
}: FAQEditorProps) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState(entry?.question ?? "");
  const [answer, setAnswer] = useState(entry?.answer ?? "");
  const [similarText, setSimilarText] = useState(
    (entry?.similarQuestions ?? []).join("\n"),
  );
  const [tagsInput, setTagsInput] = useState("");
  const [tags, setTags] = useState<string[]>(entry?.tags ?? []);
  const [category, setCategory] = useState(entry?.category ?? "");
  const [recommended, setRecommended] = useState(entry?.recommended ?? false);
  const [previewTab, setPreviewTab] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = useCallback(async () => {
    if (!question.trim()) {
      setError(t("knowledge.faq.errorQuestionRequired"));
      return;
    }
    if (!answer.trim()) {
      setError(t("knowledge.faq.errorAnswerRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const similarQuestions = similarText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      await onSave({
        question: question.trim(),
        answer: answer.trim(),
        similarQuestions,
        tags,
        category: category.trim(),
        recommended,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("knowledge.faq.errorSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }, [
    question,
    answer,
    similarText,
    tags,
    category,
    recommended,
    onSave,
    onClose,
    t,
  ]);

  const addTag = useCallback(() => {
    const tag = tagsInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagsInput("");
    }
  }, [tagsInput, tags]);

  const removeTag = useCallback(
    (tag: string) => setTags(tags.filter((tg) => tg !== tag)),
    [tags],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-2xl max-h-[90vh] rounded-xl shadow-xl flex flex-col overflow-hidden ${
          isDark
            ? "bg-gray-900 border border-gray-700"
            : "bg-white border border-gray-200"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          <h2
            className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-800"}`}
          >
            {entry
              ? t("knowledge.faq.editTitle")
              : t("knowledge.faq.createTitle")}
          </h2>
          <button
            onClick={onClose}
            className={`p-1 rounded hover:bg-gray-700/50 ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="text-xs text-red-500 bg-red-500/10 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* 问题 */}
          <label className="block">
            <span
              className={`text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {t("knowledge.faq.questionLabel")}
            </span>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t("knowledge.faq.questionPlaceholder")}
              className={`mt-1 w-full text-sm px-3 py-2 rounded-lg border outline-none ${
                isDark
                  ? "bg-gray-800 border-gray-700 text-gray-200 focus:border-blue-500"
                  : "bg-white border-gray-200 text-gray-800 focus:border-blue-400"
              }`}
            />
          </label>

          {/* 答案 — Markdown 双栏 */}
          <label className="block">
            <div className="flex items-center justify-between mb-1">
              <span
                className={`text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {t("knowledge.faq.answerLabel")}
              </span>
              <div
                className={`flex rounded-lg overflow-hidden border text-[10px] ${isDark ? "border-gray-700" : "border-gray-200"}`}
              >
                <button
                  onClick={() => setPreviewTab("edit")}
                  className={`flex items-center gap-1 px-2 py-1 ${
                    previewTab === "edit"
                      ? "bg-blue-500/20 text-blue-500"
                      : isDark
                        ? "text-gray-500"
                        : "text-gray-400"
                  }`}
                >
                  <Edit3 size={10} /> {t("common.edit")}
                </button>
                <button
                  onClick={() => setPreviewTab("preview")}
                  className={`flex items-center gap-1 px-2 py-1 ${
                    previewTab === "preview"
                      ? "bg-blue-500/20 text-blue-500"
                      : isDark
                        ? "text-gray-500"
                        : "text-gray-400"
                  }`}
                >
                  <Eye size={10} /> {t("common.preview")}
                </button>
              </div>
            </div>
            {previewTab === "edit" ? (
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={t("knowledge.faq.answerPlaceholder")}
                rows={8}
                className={`mt-1 w-full text-sm px-3 py-2 rounded-lg border outline-none resize-none font-mono ${
                  isDark
                    ? "bg-gray-800 border-gray-700 text-gray-200 focus:border-blue-500"
                    : "bg-white border-gray-200 text-gray-800 focus:border-blue-400"
                }`}
              />
            ) : (
              <div
                className={`mt-1 text-sm px-3 py-2 rounded-lg border min-h-[200px] whitespace-pre-wrap ${
                  isDark
                    ? "bg-gray-800 border-gray-700 text-gray-300"
                    : "bg-gray-50 border-gray-200 text-gray-700"
                }`}
              >
                {answer || (
                  <span className={isDark ? "text-gray-600" : "text-gray-400"}>
                    {t("knowledge.noContentPlain")}
                  </span>
                )}
              </div>
            )}
          </label>

          {/* 相似问题 — 批量粘贴 */}
          <label className="block">
            <span
              className={`text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {t("knowledge.faq.similarLabel")}
            </span>
            <textarea
              value={similarText}
              onChange={(e) => setSimilarText(e.target.value)}
              placeholder={t("knowledge.faq.similarPlaceholder")}
              rows={3}
              className={`mt-1 w-full text-xs px-3 py-2 rounded-lg border outline-none resize-none font-mono ${
                isDark
                  ? "bg-gray-800 border-gray-700 text-gray-200 focus:border-blue-500"
                  : "bg-white border-gray-200 text-gray-800 focus:border-blue-400"
              }`}
            />
          </label>

          {/* 标签 */}
          <div>
            <span
              className={`text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {t("knowledge.tags")}
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder={t("knowledge.faq.tagsPlaceholder")}
                className={`text-xs px-2 py-1.5 rounded-lg border outline-none w-32 ${
                  isDark
                    ? "bg-gray-800 border-gray-700 text-gray-200 focus:border-blue-500"
                    : "bg-white border-gray-200 text-gray-800 focus:border-blue-400"
                }`}
              />
              <button
                type="button"
                onClick={addTag}
                className={`text-[10px] px-2 py-1 rounded ${
                  isDark
                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                +
              </button>
              <div className="flex items-center gap-1 flex-wrap">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 ${
                      isDark
                        ? "bg-blue-500/20 text-blue-400"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="hover:text-red-400"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 分类 */}
          <label className="block">
            <span
              className={`text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {t("knowledge.categories")}
            </span>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={t("knowledge.faq.categoryPlaceholder")}
              className={`mt-1 w-full text-xs px-3 py-2 rounded-lg border outline-none ${
                isDark
                  ? "bg-gray-800 border-gray-700 text-gray-200 focus:border-blue-500"
                  : "bg-white border-gray-200 text-gray-800 focus:border-blue-400"
              }`}
            />
          </label>

          {/* 推荐 */}
          <label
            className={`flex items-center gap-2 cursor-pointer ${isDark ? "text-gray-300" : "text-gray-700"}`}
          >
            <input
              type="checkbox"
              checked={recommended}
              onChange={(e) => setRecommended(e.target.checked)}
              className="rounded"
            />
            <span className="text-xs">{t("knowledge.faq.recommended")}</span>
          </label>
        </div>

        {/* Footer */}
        <div
          className={`flex items-center justify-end gap-2 px-4 py-3 border-t ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          <button
            onClick={onClose}
            className={`text-xs px-3 py-1.5 rounded-lg ${
              isDark
                ? "text-gray-400 hover:bg-gray-800"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`text-xs px-4 py-1.5 rounded-lg font-medium transition-colors ${
              saving ? "opacity-50 cursor-not-allowed" : ""
            } bg-blue-600 text-white hover:bg-blue-700`}
          >
            {saving ? t("knowledge.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
});
