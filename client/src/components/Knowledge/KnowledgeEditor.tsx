import { useState, useRef, useCallback, useEffect } from "react";
import EditorToolbar from "./EditorToolbar";
import MarkdownRenderer from "../ChatArea/MarkdownRenderer";
import { handleClientError } from "../../utils/handleError";

type ViewMode = "edit" | "preview" | "split";

interface KnowledgeEditorProps {
  title: string;
  content: string;
  isDark: boolean;
  onSave: (title: string, content: string) => Promise<void>;
  onCancel: () => void;
}

const DRAFT_KEY = "liri-editor-draft";

function loadDraft(): { title: string; content: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    handleClientError(e, { module: "components:knowledge:KnowledgeEditor", action: "loadDraft" });
    return null;
  }
}

function saveDraft(title: string, content: string) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, content }));
  } catch (e) {
    handleClientError(e, { module: "components:knowledge:KnowledgeEditor", action: "saveDraft" });
    /* ignore */
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (e) {
    handleClientError(e, { module: "components:knowledge:KnowledgeEditor", action: "clearDraft" });
    /* ignore */
  }
}

function KnowledgeEditor({
  title: initialTitle,
  content: initialContent,
  isDark,
  onSave,
  onCancel,
}: KnowledgeEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [saving, setSaving] = useState(false);
  const [autoSaved, setAutoSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 同步外部 prop 变化
  useEffect(() => {
    setTitle(initialTitle);
    setContent(initialContent);
    // 清除草稿（如果有外部传入的初始内容）
    if (initialContent) clearDraft();
  }, [initialTitle, initialContent]);

  // P1-7: 草稿恢复提示
  useEffect(() => {
    if (!initialTitle && !initialContent) {
      const draft = loadDraft();
      if (draft && draft.content) {
        if (confirm("检测到未保存的编辑器草稿，是否恢复？")) {
          setTitle(draft.title);
          setContent(draft.content);
        } else {
          clearDraft();
        }
      }
    }
  }, []);

  // P1-7: 500ms debounce 自动保存
  useEffect(() => {
    if (!content.trim()) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      saveDraft(title, content);
      setAutoSaved(true);
      setTimeout(() => setAutoSaved(false), 2000);
    }, 500);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [title, content]);

  const inputBg = isDark
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "bg-white border-gray-300 text-gray-900 placeholder-gray-400";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const borderColor = isDark ? "border-gray-700" : "border-gray-200";

  const handleSave = useCallback(async () => {
    if (!title.trim() || !content.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(title.trim(), content.trim());
    } finally {
      setSaving(false);
    }
  }, [title, content, saving, onSave]);

  const viewButtons: { mode: ViewMode; icon: string; label: string }[] = [
    { mode: "edit", icon: "✏️", label: "编辑" },
    { mode: "preview", icon: "👁", label: "预览" },
    { mode: "split", icon: "↔", label: "分屏" },
  ];

  const templates: { name: string; content: string }[] = [
    {
      name: "会议纪要",
      content: `# 会议纪要\n\n**日期**: ${new Date().toISOString().slice(0, 10)}\n**参与者**: \n**主题**: \n\n## 议程\n\n1. \n\n## 决议\n\n- \n\n## 待办\n\n- [ ] \n`,
    },
    {
      name: "技术笔记",
      content: `# 技术笔记\n\n## 背景\n\n\n## 方案\n\n\`\`\`\n\n\`\`\`\n\n## 结论\n\n`,
    },
    {
      name: "FAQ",
      content: `# FAQ\n\n## Q: \n\nA: \n\n## Q: \n\nA: \n`,
    },
    {
      name: "周报",
      content: `# 周报 (${new Date().toISOString().slice(0, 10)})\n\n## 本周完成\n\n- \n\n## 遇到的问题\n\n- \n\n## 下周计划\n\n- \n`,
    },
  ];

  const editorSection = (
    <div className="flex-1 flex flex-col min-h-0">
      <EditorToolbar
        textareaRef={textareaRef}
        onContentChange={setContent}
        isDark={isDark}
      />
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="文档内容（支持 Markdown 格式）"
        className={`w-full flex-1 px-4 py-3 text-sm font-mono ${inputBg} focus:outline-none resize-none border-0`}
        data-editor-textarea
        spellCheck={false}
      />
    </div>
  );

  const previewSection = (
    <div
      className={`flex-1 overflow-y-auto px-4 py-3 ${isDark ? "bg-gray-900" : "bg-white"}`}
    >
      {content.trim() ? (
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <MarkdownRenderer content={content} />
        </div>
      ) : (
        <p className={`text-sm ${textSecondary} italic`}>（无内容）</p>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 编辑器顶部栏 */}
      <div
        className={`flex items-center justify-between px-4 py-2 border-b ${borderColor} flex-shrink-0`}
      >
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="文档标题"
          className={`flex-1 px-2 py-1 text-base font-semibold ${textPrimary} bg-transparent border-0 focus:outline-none focus:ring-0 placeholder-gray-400`}
        />
        <div className="flex items-center gap-2 ml-4">
          {/* 视图模式切换 */}
          <div
            className={`flex rounded-md border ${borderColor} overflow-hidden`}
          >
            {viewButtons.map((vb) => (
              <button
                key={vb.mode}
                onClick={() => setViewMode(vb.mode)}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  viewMode === vb.mode
                    ? "bg-blue-600 text-white"
                    : `${textSecondary} hover:bg-gray-100 dark:hover:bg-gray-700`
                }`}
                title={vb.label}
              >
                {vb.icon}
              </button>
            ))}
          </div>
          {/* 模板选择 */}
          <select
            value=""
            onChange={(e) => {
              const tpl = templates.find((t) => t.name === e.target.value);
              if (tpl) setContent(tpl.content);
              // 重置select
              (e.target as HTMLSelectElement).value = "";
            }}
            className={`text-xs px-2 py-1 rounded border ${isDark ? "bg-gray-700 border-gray-600 text-gray-300" : "bg-white border-gray-300 text-gray-600"} focus:outline-none`}
          >
            <option value="">模板</option>
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !content.trim()}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md"
          >
            {saving ? "保存中..." : "保存"}
          </button>
          {autoSaved && (
            <span className="text-[10px] text-green-500 dark:text-green-400 ml-1 transition-opacity">
              已保存
            </span>
          )}
          <button
            onClick={onCancel}
            className={`px-3 py-1.5 text-sm border ${borderColor} rounded-md ${textSecondary} hover:bg-gray-100 dark:hover:bg-gray-700`}
          >
            取消
          </button>
        </div>
      </div>

      {/* 编辑器主体 */}
      <div className="flex-1 flex min-h-0">
        {viewMode === "edit" && editorSection}
        {viewMode === "preview" && previewSection}
        {viewMode === "split" && (
          <>
            <div className="flex-1 flex flex-col min-h-0 min-w-0 border-r ${borderColor}">
              {editorSection}
            </div>
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              {previewSection}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default KnowledgeEditor;
