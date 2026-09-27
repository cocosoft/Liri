import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

interface EditorToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onContentChange: (content: string) => void;
  isDark: boolean;
}

type ToolbarAction =
  | "bold"
  | "italic"
  | "heading"
  | "ulist"
  | "olist"
  | "code"
  | "link"
  | "quote"
  | "hr";

const TOOLBAR_BUTTONS: {
  action: ToolbarAction;
  label: string;
  icon: string;
  titleKey: string;
}[] = [
  { action: "bold", label: "B", icon: "𝐁", titleKey: "knowledge.editorBold" },
  {
    action: "italic",
    label: "I",
    icon: "𝐼",
    titleKey: "knowledge.editorItalic",
  },
  {
    action: "heading",
    label: "H",
    icon: "H",
    titleKey: "knowledge.editorHeading",
  },
  { action: "ulist", label: "•", icon: "•", titleKey: "knowledge.editorUlist" },
  {
    action: "olist",
    label: "1.",
    icon: "1.",
    titleKey: "knowledge.editorOlist",
  },
  { action: "code", label: "<>", icon: "<>", titleKey: "knowledge.editorCode" },
  { action: "link", label: "🔗", icon: "🔗", titleKey: "knowledge.editorLink" },
  { action: "quote", label: "❝", icon: "❝", titleKey: "knowledge.editorQuote" },
  { action: "hr", label: "—", icon: "—", titleKey: "knowledge.editorHr" },
];

function EditorToolbar({
  textareaRef,
  onContentChange,
  isDark,
}: EditorToolbarProps) {
  const { t } = useTranslation();
  const insertSyntax = useCallback(
    (action: ToolbarAction) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = textarea.value.substring(start, end);
      const before = textarea.value.substring(0, start);
      const after = textarea.value.substring(end);

      let newText: string;
      let cursorOffset: number;

      switch (action) {
        case "bold":
          newText =
            before +
            `**${selectedText || t("knowledge.editorBoldText")}**` +
            after;
          cursorOffset = selectedText ? 0 : -4;
          break;
        case "italic":
          newText =
            before +
            `*${selectedText || t("knowledge.editorItalicText")}*` +
            after;
          cursorOffset = selectedText ? 0 : -2;
          break;
        case "heading": {
          const lineStart = before.lastIndexOf("\n") + 1;
          const lineContent = textarea.value.substring(lineStart, end);
          newText =
            before.substring(0, lineStart) +
            "## " +
            lineContent +
            after.substring(end - start);
          cursorOffset = 3;
          break;
        }
        case "ulist": {
          const lineStart = before.lastIndexOf("\n") + 1;
          const lineContent = textarea.value.substring(lineStart, end);
          newText =
            before.substring(0, lineStart) +
            "- " +
            lineContent +
            after.substring(end - start);
          cursorOffset = 2;
          break;
        }
        case "olist": {
          const lineStart = before.lastIndexOf("\n") + 1;
          const lineContent = textarea.value.substring(lineStart, end);
          newText =
            before.substring(0, lineStart) +
            "1. " +
            lineContent +
            after.substring(end - start);
          cursorOffset = 3;
          break;
        }
        case "code":
          newText =
            before +
            "```\n" +
            (selectedText || t("knowledge.editorCodeText")) +
            "\n```" +
            after;
          cursorOffset = selectedText ? 0 : -5;
          break;
        case "link":
          newText =
            before +
            `[${selectedText || t("knowledge.editorLinkText")}](url)` +
            after;
          cursorOffset = selectedText ? 0 : -5;
          break;
        case "quote": {
          const lineStart = before.lastIndexOf("\n") + 1;
          const lineContent = textarea.value.substring(lineStart, end);
          newText =
            before.substring(0, lineStart) +
            "> " +
            lineContent +
            after.substring(end - start);
          cursorOffset = 2;
          break;
        }
        case "hr":
          newText = before + "\n---\n" + after;
          cursorOffset = 5;
          break;
        default:
          return;
      }

      onContentChange(newText);

      requestAnimationFrame(() => {
        textarea.focus();
        const newCursor = start + cursorOffset;
        textarea.setSelectionRange(newCursor, newCursor);
      });
    },
    [textareaRef, onContentChange, t],
  );

  const btnBase = `px-2 py-1 text-sm rounded transition-colors ${
    isDark
      ? "text-gray-300 hover:text-gray-100 hover:bg-gray-700"
      : "text-gray-600 hover:text-gray-900 hover:bg-gray-200"
  }`;

  return (
    <div
      className={`flex items-center gap-0.5 px-3 py-1.5 border-b ${
        isDark
          ? "border-gray-700 bg-gray-800/50"
          : "border-gray-200 bg-gray-50/50"
      }`}
    >
      {TOOLBAR_BUTTONS.map((btn) => (
        <button
          key={btn.action}
          onClick={() => insertSyntax(btn.action)}
          className={btnBase}
          title={t(btn.titleKey)}
        >
          {btn.icon}
        </button>
      ))}
    </div>
  );
}

export default EditorToolbar;
