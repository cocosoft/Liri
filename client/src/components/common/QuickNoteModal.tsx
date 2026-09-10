/**
 * QuickNoteModal — 全局速记浮层（Ctrl+Shift+N 唤起）
 *
 * 速记以 source: "quick-note" 写入知识库 quick-notes 库，
 * 复用 /v1/knowledge/save-from-chat 端点；在知识库页可按「速记」来源筛选。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { knowledgeService } from "../../services/knowledgeService";
import { handleClientError } from "@/utils/handleError";
import { toastInfo } from "../../stores/toastStore";

/** 速记归属的知识库 base（后端 mkdir 自动创建） */
const QUICK_NOTE_BASE = "quick-notes";

interface QuickNoteModalProps {
  open: boolean;
  onClose: () => void;
}

/** 从正文推导标题：首个非空行去 markdown 符号后截断；无内容时回退时间戳 */
function deriveTitle(content: string): string {
  const firstLine =
    content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const cleaned = firstLine.replace(/^#+\s*/, "").replace(/[*_`]/g, "");
  if (cleaned) return cleaned.slice(0, 20);
  return new Date().toLocaleString();
}

export default function QuickNoteModal({ open, onClose }: QuickNoteModalProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  // 每次打开时清空并聚焦
  useEffect(() => {
    if (open) setText("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSave = async () => {
    const content = text.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      await knowledgeService.saveFromChat({
        base: QUICK_NOTE_BASE,
        title: deriveTitle(content),
        content,
        source: "quick-note",
      });
      toastInfo(t("quickNote.saved"));
      onClose();
    } catch (e) {
      handleClientError(e, { module: "common:QuickNoteModal", action: "save" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("quickNote.title")}
          </h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {t("quickNote.hint")}
          </span>
        </div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              void handleSave();
            }
          }}
          placeholder={t("quickNote.placeholder")}
          rows={8}
          className="w-full px-4 py-3 text-sm text-gray-800 dark:text-gray-200 bg-transparent resize-none focus:outline-none"
        />
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {t("quickNote.cancel")}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !text.trim()}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
          >
            {saving ? t("quickNote.saving") : t("quickNote.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
