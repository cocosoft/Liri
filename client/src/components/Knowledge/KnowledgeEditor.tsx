/**
 * KnowledgeEditor — 知识文档编辑器 (Phase 2 W5: 状态内部管理 + Tab切换保护)
 *
 * W5: 编辑器状态完全下沉到内部，父组件只传 file + onSave 回调。
 * 编辑器 unmount 前将草稿存到 store，重新挂载时恢复。
 */
import { useRef, useCallback, useEffect, useReducer } from "react";
import EditorToolbar from "./EditorToolbar";
import MarkdownRenderer from "../ChatArea/MarkdownRenderer";
import { useKnowledgeStore } from "../../stores/knowledgeStore";
import { knowledgeService } from "../../services/knowledgeService";
import type { KnowledgeFile } from "../../types";

type ViewMode = "edit" | "preview" | "split";

interface KnowledgeEditorProps {
  file: KnowledgeFile;
  isDark: boolean;
  onSave: (title: string, content: string) => Promise<void>;
  onCancel: () => void;
  /** U5: 从模板新建文档后的回调 */
  onFileCreated?: (doc: KnowledgeFile) => void;
}

// ── Editor reducer (替代原来的多 useState) ──
interface EditorState {
  title: string;
  content: string;
  viewMode: ViewMode;
  saving: boolean;
  autoSaved: boolean;
}

type EditorAction =
  | { type: "SET_TITLE"; title: string }
  | { type: "SET_CONTENT"; content: string }
  | { type: "SET_VIEW_MODE"; mode: ViewMode }
  | { type: "SET_SAVING"; saving: boolean }
  | { type: "SET_AUTO_SAVED"; autoSaved: boolean }
  | { type: "RESET"; title: string; content: string };

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "SET_TITLE":
      return { ...state, title: action.title };
    case "SET_CONTENT":
      return { ...state, content: action.content };
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.mode };
    case "SET_SAVING":
      return { ...state, saving: action.saving };
    case "SET_AUTO_SAVED":
      return { ...state, autoSaved: action.autoSaved };
    case "RESET":
      return { ...state, title: action.title, content: action.content };
    default:
      return state;
  }
}

const templates: { name: string; content: string }[] = [
  {
    name: "会议纪要",
    content: `# 会议纪要\n\n**日期**: ${new Date().toISOString().slice(0, 10)}\n**参与者**: \n**主题**: \n\n## 议程\n\n1. \n\n## 决议\n\n- \n\n## 待办\n\n- [ ] \n`,
  },
  {
    name: "技术笔记",
    content: "# 技术笔记\n\n## 背景\n\n\n## 方案\n\n```\n\n```\n\n## 结论\n\n",
  },
  { name: "FAQ", content: "# FAQ\n\n## Q: \n\nA: \n\n## Q: \n\nA: \n" },
  {
    name: "周报",
    content: `# 周报 (${new Date().toISOString().slice(0, 10)})\n\n## 本周完成\n\n- \n\n## 遇到的问题\n\n- \n\n## 下周计划\n\n- \n`,
  },
];

function KnowledgeEditor({
  file,
  isDark,
  onSave,
  onCancel,
  onFileCreated,
}: KnowledgeEditorProps) {
  // W5: 从 store 读取草稿
  const editorDraft = useKnowledgeStore((s) => s.editorDraft);
  const setEditorDraft = useKnowledgeStore((s) => s.setEditorDraft);

  const [state, dispatch] = useReducer(editorReducer, {
    title: editorDraft?.title ?? file.title ?? "",
    content: editorDraft?.content ?? file.content ?? "",
    viewMode: "split",
    saving: false,
    autoSaved: false,
  });

  const { title, content, viewMode, saving, autoSaved } = state;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // W5: 同步 file prop 变化（切换文档时）
  useEffect(() => {
    dispatch({
      type: "RESET",
      title: file.title ?? "",
      content: file.content ?? "",
    });
    setEditorDraft(null);
  }, [file.id]);

  // W5: 500ms auto-save 草稿到 store
  useEffect(() => {
    if (!content.trim()) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      setEditorDraft({ title, content });
      dispatch({ type: "SET_AUTO_SAVED", autoSaved: true });
      setTimeout(
        () => dispatch({ type: "SET_AUTO_SAVED", autoSaved: false }),
        2000,
      );
    }, 500);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [title, content, setEditorDraft]);

  // W5: unmount 前显式保存草稿
  useEffect(() => {
    return () => {
      const isDirty =
        title !== (file.title ?? "") || content !== (file.content ?? "");
      if (isDirty && content.trim()) {
        setEditorDraft({ title, content });
      }
    };
  }, [title, content, file.title, file.content, setEditorDraft]);

  const inputBg = isDark
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "bg-white border-gray-300 text-gray-900 placeholder-gray-400";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const borderColor = isDark ? "border-gray-700" : "border-gray-200";

  const handleSave = useCallback(async () => {
    if (!title.trim() || !content.trim() || saving) return;
    dispatch({ type: "SET_SAVING", saving: true });
    try {
      await onSave(title.trim(), content.trim());
      // 保存成功后清除草稿
      setEditorDraft(null);
    } finally {
      dispatch({ type: "SET_SAVING", saving: false });
    }
  }, [title, content, saving, onSave, setEditorDraft]);

  const viewButtons: { mode: ViewMode; icon: string; label: string }[] = [
    { mode: "edit", icon: "✏️", label: "编辑" },
    { mode: "preview", icon: "👁", label: "预览" },
    { mode: "split", icon: "↔", label: "分屏" },
  ];

  const editorSection = (
    <div className="flex-1 flex flex-col min-h-0">
      <EditorToolbar
        textareaRef={textareaRef}
        onContentChange={(c) => dispatch({ type: "SET_CONTENT", content: c })}
        isDark={isDark}
      />
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) =>
          dispatch({ type: "SET_CONTENT", content: e.target.value })
        }
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
      {/* 顶部栏 */}
      <div
        className={`flex items-center justify-between px-4 py-2 border-b ${borderColor} flex-shrink-0`}
      >
        <input
          type="text"
          value={title}
          onChange={(e) =>
            dispatch({ type: "SET_TITLE", title: e.target.value })
          }
          placeholder="文档标题"
          className={`flex-1 px-2 py-1 text-base font-semibold ${textPrimary} bg-transparent border-0 focus:outline-none focus:ring-0 placeholder-gray-400`}
        />
        <div className="flex items-center gap-2 ml-4">
          {/* 视图模式 */}
          <div
            className={`flex rounded-md border ${borderColor} overflow-hidden`}
          >
            {viewButtons.map((vb) => (
              <button
                key={vb.mode}
                onClick={() =>
                  dispatch({ type: "SET_VIEW_MODE", mode: vb.mode })
                }
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
          {/* U5: 模板 → 新建文档 */}
          <select
            value=""
            onChange={async (e) => {
              const tpl = templates.find((t) => t.name === e.target.value);
              if (!tpl) return;
              (e.target as HTMLSelectElement).value = "";
              try {
                const title = `${tpl.name} - ${new Date().toLocaleDateString("zh-CN")}`;
                // KB-TPL（2026-08-27）：后端 create 按 category 路由到 base 目录——
                // 此前不传 category 文档落到根目录，但 newFile.base 却用当前 base，
                // 导致新建文档出现在错误的知识库下
                const doc = await knowledgeService.create({
                  title,
                  content: tpl.content,
                  tags: [tpl.name],
                  // 空 base / "根目录" 时回退 undefined（后端走根目录）
                  category: file.base !== "根目录" ? file.base : undefined,
                });
                const newFile: KnowledgeFile = {
                  id: doc.id,
                  title: doc.title,
                  content: tpl.content,
                  tags: [tpl.name],
                  category: "",
                  docPath: doc.id,
                  size: 0,
                  source: "manual" as const,
                  created_at: doc.created_at,
                  updated_at: doc.updated_at,
                  base: file.base || "",
                };
                onFileCreated?.(newFile);
              } catch {
                // 创建失败静默忽略
              }
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
            <span className="text-[10px] text-green-500 dark:text-green-400 ml-1">
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
            <div
              className={`flex-1 flex flex-col min-h-0 min-w-0 border-r ${borderColor}`}
            >
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
