/**
 * KnowledgePage — 知识库主页面
 *
 * W2: store 驱动，display 控制 Tab
 * W4: 统一 useToast 通知
 * U1: 砍掉检索 Tab，侧边栏搜索结果在右侧展示
 */
import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useKnowledgeStore } from "../../stores/knowledgeStore";
import { useConfigStore } from "../../stores/configStore";
import { useRootStore } from "../../stores/root-store";
import { knowledgeService } from "../../services/knowledgeService";
import type {
  KnowledgeFile,
  KnowledgeSearchHit,
  BucketedRuleItem,
  BucketedFaqItem,
  BucketedRecordItem,
  BucketedSourceItem,
} from "../../types";
import { SearchHitCard } from "../Knowledge/SearchHitCard";
import { StrengthBadge } from "../Knowledge/StrengthBadge";
import { CitationText } from "../Knowledge/CitationText";
import { toastError } from "../../stores/toastStore";
import { createLogger } from "@/utils/logger";
import { useToast, ToastContainer } from "../../hooks/useToast";
// P1：打包版（Tauri 自定义协议）下相对 /v1 不可达，统一用绝对 backend URL
import { getBackendBaseUrl } from "../../services/backendUrl";

const logger = createLogger("components:knowledge");

import KnowledgeBaseList from "../Knowledge/KnowledgeBaseList";
import KnowledgeEditor from "../Knowledge/KnowledgeEditor";
import SemanticIndexPage from "./SemanticIndexPage";
import { formatFileSize, formatDateTime } from "../Knowledge/shared/utils";
import { sourceLabels } from "../Knowledge/shared/constants";
import StatsPanel from "../Knowledge/StatsPanel";
import VersionHistory from "../Knowledge/VersionHistory";
import MarkdownRenderer from "../ChatArea/MarkdownRenderer";
import { useSessionContextSync } from "../../hooks/useSessionContextSync";
import { FAQPage } from "../Knowledge/FAQ/FAQPage";
import { GraphPage } from "../Knowledge/Graph/GraphPage";
import { DataSourcePage } from "../Knowledge/DataSource/DataSourcePage";
import { KnowledgeSettingsPanel } from "../Knowledge/Settings/KnowledgeSettingsPanel";

/** P1-1: 二级导航页内 Tab key（activeTab 由 URL query ?tab= 驱动） */
type KnowledgeTabKey =
  "knowledge" | "semantic" | "faq" | "graph" | "config" | "datasources";

function KnowledgePageSkeleton() {
  return (
    <div className="flex-1 overflow-hidden bg-gray-50 dark:bg-gray-900 animate-pulse">
      <div className="h-full flex flex-col">
        <div className="flex items-center px-6 py-3 border-b border-gray-200 dark:border-gray-700 gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-16 h-4 bg-gray-200 dark:bg-gray-700 rounded"
            />
          ))}
        </div>
        <div className="flex-1 flex">
          <div className="w-96 lg:w-[420px] border-r border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="w-16 h-16 mx-auto bg-gray-200 dark:bg-gray-700 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * F2：搜索结果带行号时，打开文档后在正文上方给出"命中位置"行窗口预览
 * （按源文件行号近似定位；Markdown 渲染行与源行非 1:1，展示为可关闭的定位条）
 */
function HitAnchorPreview({
  content,
  startLine,
  endLine,
  isDark,
  onClose,
}: {
  content: string;
  startLine: number;
  endLine?: number;
  isDark: boolean;
  onClose: () => void;
}) {
  const lines = content.split("\n");
  const target = Math.min(Math.max(1, startLine), lines.length);
  const from = Math.max(1, target - 2);
  const minTo = Math.min(lines.length, target + 3);
  const to = Math.min(
    lines.length,
    endLine !== undefined && endLine >= target
      ? Math.max(minTo, endLine)
      : minTo,
  );
  const rows = [];
  for (let i = from; i <= to; i++)
    rows.push({ num: i, text: lines[i - 1] ?? "" });
  return (
    <div
      className={`mb-3 rounded-lg border text-xs ${
        isDark
          ? "border-yellow-600/40 bg-yellow-500/5"
          : "border-yellow-300 bg-yellow-50"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-current/10">
        <span className="text-yellow-700 dark:text-yellow-400 font-medium">
          命中位置（约第 {target} 行）
          {endLine !== undefined && endLine > target ? ` - L${endLine}` : ""}
        </span>
        <button
          onClick={onClose}
          className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs"
        >
          关闭
        </button>
      </div>
      <div className="px-3 py-2 font-mono space-y-0.5 max-h-48 overflow-auto">
        {rows.map((row) => (
          <div
            key={row.num}
            className={
              row.num === target
                ? "bg-yellow-200/70 dark:bg-yellow-500/20 rounded px-1"
                : "opacity-70 px-1"
            }
          >
            <span className="inline-block w-12 text-right mr-2 select-none text-gray-400">
              L{row.num}
            </span>
            <span className="whitespace-pre-wrap break-all">{row.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * P2#15：分桶关联区（规则/FAQ/记录/原文）——独立组件，
 * 在「有文档命中」与「文档 0 命中但桶有命中」两种状态下复用，避免吞掉桶结果。
 */
function BucketAssociations({
  rules,
  faqs,
  records,
  sources,
  isDark,
  tagNote,
  onOpenRule,
  onOpenSource,
  onPdfPreview,
}: {
  rules: BucketedRuleItem[];
  faqs: BucketedFaqItem[];
  records: BucketedRecordItem[];
  sources: BucketedSourceItem[];
  isDark: boolean;
  tagNote: boolean;
  onOpenRule: (sourceFile: string | undefined, kind: string) => void;
  onOpenSource: (s: BucketedSourceItem) => void;
  onPdfPreview: (s: BucketedSourceItem) => void;
}) {
  return (
    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
        规则 / FAQ / 记录 / 原文关联
        {tagNote && (
          <span className="ml-1 text-[10px] font-normal opacity-70">
            （标签过滤仅作用于文档结果）
          </span>
        )}
      </div>
      {rules.map((r) => (
        <div
          key={`rule-${r.ruleId}`}
          className="flex items-start gap-2 text-sm leading-snug"
        >
          <StrengthBadge strength={r.constraintStrength} />
          <span className="flex-1">
            <CitationText text={r.statement} />
          </span>
          {/* F3：规则出处回链 → 打开来源文档 */}
          {r.sourceFile && (
            <button
              onClick={() => onOpenRule(r.sourceFile, r.kind)}
              title={`出处：${r.sourceFile}`}
              className="text-[10px] text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 shrink-0 mt-0.5"
            >
              出处
            </button>
          )}
        </div>
      ))}
      {faqs.map((f) => (
        <div
          key={`faq-${f.id}`}
          className="flex flex-col gap-0.5 text-sm leading-snug"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-purple-600 dark:text-purple-400">
              FAQ
            </span>
            {/* F3：FAQ 归属知识库（base）标注 */}
            {f.knowledgeBaseName && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-500"}`}
              >
                {f.knowledgeBaseName}
              </span>
            )}
            <span className="font-medium">
              <CitationText text={f.question} />
            </span>
          </div>
          <p className="text-xs opacity-70 line-clamp-2 pl-7">
            <CitationText text={f.answer} />
          </p>
        </div>
      ))}
      {records.map((r) => (
        <div
          key={`record-${r.recordId}`}
          className="flex flex-col gap-0.5 text-sm leading-snug"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono font-medium text-emerald-600 dark:text-emerald-400">
              记录
            </span>
            <span className="font-mono text-xs font-medium">
              {r.type}:{r.key}
            </span>
          </div>
          <p className="text-xs opacity-70 line-clamp-2 pl-7 font-mono">
            {Object.entries(r.data)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(" · ")
              .slice(0, 180)}
          </p>
        </div>
      ))}
      {sources.map((s, idx) => (
        <div
          key={`source-${s.docPath}-${idx}`}
          className="flex items-start gap-2 text-sm leading-snug"
        >
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 shrink-0 mt-0.5">
            原文{s.page !== undefined ? ` p.${s.page}` : ""}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpenSource(s)}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
              >
                {s.title}
              </button>
              {s.rawPath && /\.pdf$/i.test(s.rawPath) && (
                <button
                  onClick={() => onPdfPreview(s)}
                  title="应用内预览 PDF"
                  className="text-[10px] text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 hover:underline shrink-0"
                >
                  PDF预览
                </button>
              )}
            </div>
            <p className="text-xs opacity-70 line-clamp-2">
              <CitationText text={s.text} />
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function KnowledgePage() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const enterModule = useRootStore((s) => s.enterModule);
  const leaveModule = useRootStore((s) => s.leaveModule);
  useEffect(() => {
    enterModule({ moduleType: "knowledge" });
    return () => leaveModule();
  }, [enterModule, leaveModule]);

  const view = useKnowledgeStore((s) => s.view);
  const setView = useKnowledgeStore((s) => s.setView);
  // B7/B8：分桶规则/FAQ 以当前选中的知识库（base）为作用域
  const { selectedBase } = view;
  const editor = useKnowledgeStore((s) => s.editor);
  const setEditor = useKnowledgeStore((s) => s.setEditor);
  const search = useKnowledgeStore((s) => s.search);
  const setSearch = useKnowledgeStore((s) => s.setSearch);
  const clearSearch = useKnowledgeStore((s) => s.clearSearch);
  // P2#8：标签过滤仅作用于文档结果（关联桶不按标签过滤）——用于桶区说明文案
  const listSearchTags = useKnowledgeStore((s) => s.list.searchTags);
  // KB：列表刷新信号——保存/删除/trash 后递增，useKnowledgeBaseList 监听并重载左侧列表
  const dispatchList = useKnowledgeStore((s) => s.dispatchList);

  const { toasts, show: showToast, dismiss } = useToast(3000);
  const [showStats, setShowStats] = useState(false);
  // P1-3: 列表真实总数（与侧边栏分页列表口径一致，替代 store.items 全量计数）
  const [listTotal, setListTotal] = useState(0);
  // KB-R3：内联 VersionHistory 面板锚点（菜单"历史版本"滚动定位）
  const versionHistoryRef = useRef<HTMLDivElement | null>(null);
  // KB-L1：文档选择请求序号（快速切换时丢弃过期响应）
  const selectFileSeqRef = useRef(0);
  // F2：搜索结果命中行号锚点（打开文档后正文上方显示行窗口定位）
  const [hitAnchor, setHitAnchor] = useState<{
    docId: string;
    startLine?: number;
    endLine?: number;
  } | null>(null);
  // F5：原文 PDF 内嵌预览（浏览器原生 PDF viewer，#page=N 定位）
  const [rawPdf, setRawPdf] = useState<{
    file: string;
    page?: number;
    title: string;
  } | null>(null);

  // R3+B7：分桶搜索补充态（提交搜索时并行拉取 rules/faqs/records/sources）
  const [bucketRules, setBucketRules] = useState<BucketedRuleItem[]>([]);
  const [bucketFaqs, setBucketFaqs] = useState<BucketedFaqItem[]>([]);
  const [bucketRecords, setBucketRecords] = useState<BucketedRecordItem[]>([]);
  const [bucketSources, setBucketSources] = useState<BucketedSourceItem[]>([]);
  const bucketSeqRef = useRef(0);
  useEffect(() => {
    // P2#7：只随「已提交查询快照」拉取分桶——输入框后续敲字（未重提交）不再触发
    const query = search.hasSearched ? search.submittedQuery?.trim() : null;
    if (!query) {
      setBucketRules([]);
      setBucketFaqs([]);
      setBucketRecords([]);
      setBucketSources([]);
      return;
    }
    const seq = ++bucketSeqRef.current;
    knowledgeService
      .searchBucketed(query, selectedBase ?? undefined)
      .then((b) => {
        if (seq !== bucketSeqRef.current) return;
        setBucketRules(b.rules ?? []);
        setBucketFaqs(b.faqs ?? []);
        setBucketRecords(b.records ?? []);
        setBucketSources(b.sources ?? []);
      })
      .catch(() => {
        if (seq !== bucketSeqRef.current) return;
        setBucketRules([]);
        setBucketFaqs([]);
        setBucketRecords([]);
        setBucketSources([]);
      });
    return () => {
      // 下一次提交自增 seq 即丢弃过期响应
    };
  }, [search.submittedQuery, search.hasSearched, selectedBase]);

  // P1-1: activeTab 由 URL query 驱动（?tab=xxx），根治"全局 store 残留"类问题
  const [searchParams, setSearchParams] = useSearchParams();
  // KB-P3：非法 ?tab= 参数校验，回退到 knowledge，避免整页空白无回退
  const TAB_KEYS: KnowledgeTabKey[] = [
    "knowledge",
    "semantic",
    "faq",
    "graph",
    "config",
    "datasources",
  ];
  const rawTab = searchParams.get("tab") ?? "knowledge";
  const activeTab: KnowledgeTabKey = TAB_KEYS.includes(
    rawTab as KnowledgeTabKey,
  )
    ? (rawTab as KnowledgeTabKey)
    : "knowledge";

  const { selectedFile, isInitialLoading } = view;

  // P0-3 修复：解构 scheduleSave，在 search.query / selectedFile 变更时显式触发保存
  const { scheduleSave } = useSessionContextSync("knowledge", {
    save: () => ({
      moduleType: "knowledge" as const,
      query: search.query || undefined,
      selectedDocIds: selectedFile ? [selectedFile.id] : undefined,
    }),
    restore: (ctx) => {
      if (ctx.moduleType !== "knowledge") return;
      if (ctx.query) setSearch({ query: ctx.query });
    },
  });

  /** P0-3：search.query / selectedFile 变更时触发保存 */
  const searchQuery = search.query;
  const selectedFileId = selectedFile?.id;
  const prevKnowledgeStateRef = useRef({ searchQuery, selectedFileId });
  useEffect(() => {
    const prev = prevKnowledgeStateRef.current;
    if (
      prev.searchQuery !== searchQuery ||
      prev.selectedFileId !== selectedFileId
    ) {
      prevKnowledgeStateRef.current = { searchQuery, selectedFileId };
      logger.debug("[P0-3:KnowledgePage] 知识库状态变更，触发 scheduleSave", {
        query: searchQuery,
        selectedFileId,
      });
      scheduleSave();
    }
  }, [searchQuery, selectedFileId, scheduleSave]);

  useEffect(() => {
    (async () => {
      try {
        const bases = await knowledgeService.listBases();
        if (bases.length > 0 && !selectedBase)
          setView({ selectedBase: bases[0].name });
      } finally {
        setView({ isInitialLoading: false });
      }
    })();
  }, []);

  const bgClass = isDark ? "bg-gray-900" : "bg-gray-50";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const inputBg = isDark
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "bg-white border-gray-300 text-gray-900 placeholder-gray-400";
  const borderColor = isDark ? "border-gray-700" : "border-gray-200";

  function handleSelectBase(baseName: string | null) {
    setView({ selectedBase: baseName, selectedFile: null });
    // P2-9: 清空编辑器草稿，避免残留内容误存到其他知识库
    setEditor({ isEditing: false, editTitle: "", editContent: "" });
    // KB-C4：切库清空搜索结果与查询 —— 旧库结果用新 base 打开会元数据错位
    clearSearch();
  }

  async function handleSelectFile(file: KnowledgeFile) {
    if (selectedFile?.id === file.id) return;
    // F2：从普通列表打开文档无行号锚点，清除残留命中定位
    setHitAnchor(null);
    // KB-L1：快速连续切换文档时，丢弃过期请求返回（防慢响应覆盖新选中项）
    const seq = ++selectFileSeqRef.current;
    // KB-DOC（2026-08-27）：列表接口 includeContent=false 只返回裁剪内容（200 字符），
    // 打开文档时按 docPath 拉全文，保证编辑器/详情看到完整内容
    let full = file;
    try {
      const doc = await knowledgeService.getDoc(file.docPath || file.id);
      if (seq !== selectFileSeqRef.current) return; // KB-L1
      if (doc) {
        full = { ...file, ...doc };
      } else {
        // getDoc 未命中时退回列表接口拉真实元数据（P3-2 通道，含完整 content），
        // 防止以裁剪内容进入编辑器后保存导致数据丢失
        const real = await knowledgeService.getFileByDocPath(
          file.docPath || file.id,
          file.base || undefined,
        );
        if (real) full = { ...file, ...real };
        else {
          // KB-P4：双通道均未取到全文，明确提示，禁止静默以裁剪内容进入编辑器
          toastError("无法获取文档全文，当前为截断预览，请勿直接保存");
        }
      }
    } catch {
      // KB-P4：拉取异常同样明确提示（原静默降级可能被保存覆盖全文）
      toastError("获取文档全文失败，请检查后端连接后重试");
    }
    if (seq !== selectFileSeqRef.current) return; // KB-L1：过期响应丢弃
    setView({ selectedFile: full });
    setEditor({
      isEditing: false,
      editTitle: full.title,
      editContent: full.content,
    });
  }

  /** P0-5 + P3-2: 搜索结果元数据为列表占位时，按 docPath 拉真实元数据（统一走 knowledgeService.getFileByDocPath） */
  async function handleSelectSearchHit(hit: KnowledgeSearchHit) {
    // KB-C2：hit 保留完整 file 元数据（score/matchType/domain 仅用于卡片展示），选中仍打开文档
    // KB-DOC：handleSelectFile 已通过 getDoc 拉全文 + 真实元数据，不再需要 getFileByDocPath
    const nextAnchor =
      hit.startLine !== undefined
        ? {
            docId: hit.file.id,
            startLine: hit.startLine,
            endLine: hit.endLine,
          }
        : null;
    // F2：当前已打开同一文档时仅更新锚点行，不重复拉全文
    if (selectedFile?.id === hit.file.id) {
      setHitAnchor(nextAnchor);
      return;
    }
    setHitAnchor(null);
    await handleSelectFile(hit.file);
    setHitAnchor(nextAnchor);
  }

  /** B7/F3：按相对 docPath 打开知识文档（docPath 可被 getDoc 解析） */
  function openDocPath(docPath: string, title?: string) {
    void handleSelectFile({
      id: docPath,
      title: title ?? docPath,
      content: "",
      tags: [],
      category: "",
      docPath,
      size: 0,
      updated_at: 0,
      created_at: 0,
      source: "compiled",
      base: selectedBase ?? "",
    });
  }

  /** B7：原文块（sources 桶）命中 → 打开对应编译页/文档 */
  function openBucketSource(s: BucketedSourceItem) {
    openDocPath(s.docPath, s.title);
  }

  /** F5：sources 桶 PDF 命中 → 应用内内嵌预览（iframe 到 raw-preview，#page=N） */
  function openPdfPreview(s: BucketedSourceItem) {
    if (!s.rawPath) return;
    setRawPdf({ file: s.rawPath, page: s.page, title: s.title });
  }

  function startEditing() {
    if (!selectedFile) return;
    setEditor({
      isEditing: true,
      editTitle: selectedFile.title,
      editContent: selectedFile.content,
    });
  }

  async function handleSaveTags() {
    if (!selectedFile) return;
    const tags = editor.editTagsInput
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      await knowledgeService.updateDoc(
        selectedFile.id,
        selectedFile.content,
        selectedFile.title,
        { tags },
      );
      setView({
        selectedFile: { ...selectedFile, tags },
      });
      setEditor({ editingTags: false });
      // KB：标签保存后刷新列表，元数据同步
      dispatchList({ type: "REFRESH_LIST" });
    } catch (err) {
      logger.error("保存标签失败", err);
    }
  }

  async function handleExportToNotebook() {
    if (!selectedFile) return;
    try {
      const result = await knowledgeService.exportToNotebook(
        selectedFile.docPath || selectedFile.id,
        selectedFile.title,
      );
      showToast("success", `已导出到 Notebook: ${result.fileName}`);
    } catch (err) {
      showToast(
        "error",
        `导出失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function startEditTags() {
    if (!selectedFile) return;
    setEditor({
      editTagsInput: selectedFile.tags?.join(", ") || "",
      editingTags: true,
    });
  }

  async function handleSaveEdit(title: string, content: string) {
    if (!selectedFile) return;
    try {
      await knowledgeService.updateDoc(selectedFile.id, content, title);
      setView({
        selectedFile: {
          ...selectedFile,
          title,
          content,
          updated_at: Date.now(),
        },
      });
      setEditor({ isEditing: false });
      // KB：保存后刷新左侧列表，保证标题/元数据同步（此前仅更新右侧选中项）
      dispatchList({ type: "REFRESH_LIST" });
    } catch (err) {
      logger.error("保存失败", err);
    }
  }

  async function handleDeleteFile() {
    if (!selectedFile) return;
    // KB-P1：删除无确认 + HTTP 硬删不可恢复，误触即永久丢失；与 FAQ/数据源删除一致加确认
    if (!window.confirm(`确定删除「${selectedFile.title}」？此操作不可恢复。`))
      return;
    try {
      await knowledgeService.delete(selectedFile.id);
      setView({ selectedFile: null });
      setEditor({ isEditing: false });
      // KB：删除后刷新左侧列表，避免残留旧项
      dispatchList({ type: "REFRESH_LIST" });
    } catch (err) {
      logger.error("删除失败", err);
    }
  }

  function cancelEditing() {
    setEditor({ isEditing: false });
    if (selectedFile)
      setEditor({
        editTitle: selectedFile.title,
        editContent: selectedFile.content,
      });
  }

  // ── U1: 搜索结果计算 ──
  // KB-C3：isSearchActive 表示"已提交搜索"（区分输入框有字，避免敲字即切走文档视图）
  const isSearchActive = search.hasSearched;
  const searchResults = search.listResults;

  const tabs: { key: KnowledgeTabKey; label: string }[] = [
    { key: "knowledge", label: "知识库" },
    { key: "semantic", label: "语义索引" },
    { key: "faq", label: "FAQ" },
    { key: "graph", label: "知识图谱" },
    { key: "config", label: "知识库设置" },
    { key: "datasources", label: "数据源" },
  ];

  // P1-1: 全部页内切换，activeTab 同步到 URL query
  function switchTab(key: KnowledgeTabKey) {
    setSearchParams(key === "knowledge" ? {} : { tab: key });
  }

  if (isInitialLoading) return <KnowledgePageSkeleton />;

  return (
    <div className={`flex-1 overflow-y-auto ${bgClass}`}>
      <div className="h-full flex flex-col">
        <ToastContainer toasts={toasts} dismiss={dismiss} isDark={isDark} />

        {/* F5：原文 PDF 应用内预览（浏览器原生 PDF viewer；#page=N 尽力定位） */}
        {rawPdf && (
          <div
            className="fixed inset-0 z-50 flex flex-col bg-black/60 p-4"
            onClick={() => setRawPdf(null)}
          >
            <div
              className="mx-auto w-full max-w-4xl flex-1 min-h-0 flex flex-col bg-white dark:bg-gray-900 rounded-lg shadow-xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 text-sm">
                <span className="font-medium truncate">
                  {rawPdf.title}
                  {rawPdf.page !== undefined ? `（第 ${rawPdf.page} 页）` : ""}
                </span>
                <button
                  onClick={() => setRawPdf(null)}
                  className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  关闭
                </button>
              </div>
              <iframe
                title={`PDF-${rawPdf.title}`}
                className="flex-1 w-full min-h-0 bg-gray-100 dark:bg-gray-800"
                src={`${getBackendBaseUrl()}/v1/knowledge/raw-preview?file=${encodeURIComponent(
                  rawPdf.file,
                )}${rawPdf.page ? `#page=${rawPdf.page}` : ""}`}
              />
            </div>
          </div>
        )}

        {/* Tab 导航 + 统计徽章 */}
        <div
          className={`flex items-center justify-between px-6 py-3 border-b ${borderColor} flex-shrink-0`}
        >
          <div className="flex gap-6">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => switchTab(tab.key)}
                className={`text-sm font-medium transition-colors pb-1 border-b-2 ${
                  activeTab === tab.key
                    ? "border-blue-500 text-blue-500"
                    : `border-transparent ${textSecondary} hover:text-gray-700 dark:hover:text-gray-300`
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {/* U4: 统计徽章 */}
          <button
            onClick={() => setShowStats(true)}
            className={`text-xs ${textSecondary} hover:text-blue-500 dark:hover:text-blue-400 transition-colors flex items-center gap-1`}
            title="知识统计"
          >
            📊 {listTotal > 0 ? listTotal : ""}
          </button>
        </div>

        {/* U4: 统计 Modal */}
        {showStats && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => setShowStats(false)}
          >
            <div
              className="w-full max-w-3xl max-h-[80vh] overflow-y-auto m-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl">
                <button
                  onClick={() => setShowStats(false)}
                  className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg"
                >
                  ✕
                </button>
                <StatsPanel isDark={isDark} />
              </div>
            </div>
          </div>
        )}

        {/* ── 知识库 Tab ── */}
        <div
          style={{ display: activeTab === "knowledge" ? "flex" : "none" }}
          className="flex-1 overflow-hidden"
        >
          <div className="flex-1 flex overflow-hidden">
            <div
              className={`w-96 lg:w-[420px] flex-shrink-0 border-r ${borderColor} flex flex-col overflow-hidden`}
            >
              <div className="overflow-hidden flex-1">
                <KnowledgeBaseList
                  isDark={isDark}
                  selectedBase={selectedBase}
                  onSelectBase={handleSelectBase}
                  onSelectFile={handleSelectFile}
                  selectedFileId={selectedFile?.id || null}
                  onTotalChange={setListTotal}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* U1: 搜索激活 → 展示搜索结果 */}
              {isSearchActive ? (
                <div className="p-6 max-w-3xl mx-auto">
                  {search.isListSearching ? (
                    <div className="text-center py-8 text-gray-400">
                      <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                      <span className="text-xs">搜索中...</span>
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="space-y-6">
                      <div className="text-center py-10 text-gray-400">
                        <svg
                          className="w-12 h-12 mx-auto mb-3 opacity-40"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                          />
                        </svg>
                        {/* KB-P2：搜索失败 ≠ 真实无结果 —— 优先显示错误而非"未找到匹配文档" */}
                        {search.searchError ? (
                          <>
                            <p className="text-sm text-red-500 dark:text-red-400">
                              {search.searchError}
                            </p>
                            <p className="text-xs mt-1 opacity-60">
                              可稍后重试，或清除搜索返回文档列表
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm">未找到匹配文档</p>
                            <p className="text-xs mt-1 opacity-60">
                              试试缩短关键词、调整分类筛选
                            </p>
                          </>
                        )}
                        <button
                          onClick={clearSearch}
                          className="mt-2 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400"
                        >
                          清除搜索
                        </button>
                      </div>
                      {/* P2#15：文档 0 命中但桶有命中时仍展示关联（不再吞掉） */}
                      {(bucketRules.length > 0 ||
                        bucketFaqs.length > 0 ||
                        bucketRecords.length > 0 ||
                        bucketSources.length > 0) && (
                        <BucketAssociations
                          rules={bucketRules}
                          faqs={bucketFaqs}
                          records={bucketRecords}
                          sources={bucketSources}
                          isDark={isDark}
                          tagNote={listSearchTags.length > 0}
                          onOpenRule={(src, kind) =>
                            openDocPath(src ?? "", kind)
                          }
                          onOpenSource={openBucketSource}
                          onPdfPreview={openPdfPreview}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          共 {searchResults.length} 条结果
                        </span>
                        <button
                          onClick={clearSearch}
                          className="text-[10px] text-blue-500 hover:text-blue-600 dark:text-blue-400"
                        >
                          清除搜索
                        </button>
                      </div>
                      {searchResults.map((result, idx) => (
                        // KB-C2：启用 SearchHitCard（分数/匹配类型/domain 徽章），原死代码组件
                        <SearchHitCard
                          key={result.file.id}
                          hit={result}
                          index={idx}
                          isDark={isDark}
                          onClick={() => handleSelectSearchHit(result)}
                        />
                      ))}
                      {/* R3+B7+P2#15：分桶关联（复用组件，空结果也可展示） */}
                      {(bucketRules.length > 0 ||
                        bucketFaqs.length > 0 ||
                        bucketRecords.length > 0 ||
                        bucketSources.length > 0) && (
                        <BucketAssociations
                          rules={bucketRules}
                          faqs={bucketFaqs}
                          records={bucketRecords}
                          sources={bucketSources}
                          isDark={isDark}
                          tagNote={listSearchTags.length > 0}
                          onOpenRule={(src, kind) =>
                            openDocPath(src ?? "", kind)
                          }
                          onOpenSource={openBucketSource}
                          onPdfPreview={openPdfPreview}
                        />
                      )}
                    </div>
                  )}
                </div>
              ) : !selectedFile ? (
                <div
                  className={`flex items-center justify-center h-full ${textSecondary}`}
                >
                  <div className="text-center">
                    <svg
                      className="w-16 h-16 mx-auto mb-4 opacity-30"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <p className="text-sm">选择一个知识文档查看详情</p>
                    <p className="text-xs mt-1 opacity-60">
                      左侧列表列出了当前知识库下的所有文档
                    </p>
                    <div className="flex items-center justify-center gap-3 mt-4">
                      <button
                        onClick={() => {
                          const el = document.querySelector<HTMLButtonElement>(
                            '[data-testid="file-upload-trigger"]',
                          );
                          el?.click();
                        }}
                        className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                      >
                        上传文档
                      </button>
                      <button
                        onClick={() => setShowStats(true)}
                        className="px-3 py-1.5 text-xs border rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        查看统计
                      </button>
                    </div>
                  </div>
                </div>
              ) : editor.isEditing && selectedFile ? (
                <KnowledgeEditor
                  file={selectedFile}
                  isDark={isDark}
                  onSave={handleSaveEdit}
                  onCancel={cancelEditing}
                  onFileCreated={(newFile) => {
                    handleSelectFile(newFile);
                  }}
                />
              ) : (
                <div className="p-6 max-w-3xl mx-auto">
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex-1 min-w-0">
                      <h2
                        className={`text-xl font-bold ${textPrimary} break-words`}
                      >
                        {selectedFile.title || "未命名文档"}
                      </h2>
                      <div className="flex items-center gap-3 mt-2">
                        <span className={`text-xs ${textSecondary}`}>
                          {formatFileSize(selectedFile.size)}
                        </span>
                        <span className={`text-xs ${textSecondary}`}>
                          更新于 {formatDateTime(selectedFile.updated_at)}
                        </span>
                        {selectedFile.source && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"}`}
                          >
                            {sourceLabels[selectedFile.source] ||
                              selectedFile.source}
                          </span>
                        )}
                        {selectedFile.base && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${isDark ? "bg-blue-900/30 text-blue-400" : "bg-blue-50 text-blue-600"}`}
                          >
                            {selectedFile.base}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* ── U3: 操作按钮区分 pri/sec ── */}
                    <DetailsMenu
                      isDark={isDark}
                      onStartEdit={startEditing}
                      onSendToChat={() => {
                        if (!selectedFile) return;
                        window.dispatchEvent(
                          new CustomEvent("liri:append-knowledge", {
                            detail: {
                              title: selectedFile.title,
                              content: selectedFile.content,
                            },
                          }),
                        );
                      }}
                      onExportNotebook={handleExportToNotebook}
                      onZipExport={() => {
                        // P1：绝对 backend URL（打包版自定义协议下相对 /v1 不可达）
                        const exportUrl = `${getBackendBaseUrl()}/v1/knowledge/export?base=${encodeURIComponent(selectedBase || "all")}`;
                        const win = window.open(exportUrl, "_blank");
                        if (!win) {
                          toastError("导出被浏览器拦截，请允许弹出窗口后重试");
                        }
                      }}
                      onVersionHistory={() =>
                        // KB-R3：菜单"历史版本"滚动定位到下方内联 VersionHistory（原死按钮无反馈）
                        versionHistoryRef.current?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        })
                      }
                      onTrash={async () => {
                        if (!selectedFile) return;
                        const ok = await knowledgeService.trash(
                          selectedFile.id,
                        );
                        if (ok) {
                          setView({ selectedFile: null });
                          setEditor({ isEditing: false });
                          // KB：trash 后刷新左侧列表
                          dispatchList({ type: "REFRESH_LIST" });
                        }
                      }}
                      onDelete={handleDeleteFile}
                    />
                  </div>

                  {/* F2：搜索结果带行号 → 打开后正文上方显示命中位置行窗口 */}
                  {hitAnchor &&
                    selectedFile &&
                    hitAnchor.docId === selectedFile.id &&
                    hitAnchor.startLine !== undefined && (
                      <HitAnchorPreview
                        content={selectedFile.content}
                        startLine={hitAnchor.startLine}
                        endLine={hitAnchor.endLine}
                        isDark={isDark}
                        onClose={() => setHitAnchor(null)}
                      />
                    )}

                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    {selectedFile.content ? (
                      <MarkdownRenderer content={selectedFile.content} />
                    ) : (
                      <span className="text-gray-400">（无内容）</span>
                    )}
                  </div>

                  {selectedFile.title && (
                    <div ref={versionHistoryRef}>
                      <VersionHistory
                        isDark={isDark}
                        title={selectedFile.title}
                        currentContent={selectedFile.content}
                        onRestored={(content) => {
                          // P2-5: 恢复成功后刷新当前文档内容
                          const updated = { ...selectedFile, content };
                          setView({ selectedFile: updated });
                          setEditor({
                            editTitle: updated.title,
                            editContent: content,
                          });
                        }}
                      />
                    </div>
                  )}

                  <div className={`mt-8 pt-4 border-t ${borderColor}`}>
                    <h4 className={`text-sm font-medium ${textPrimary} mb-2`}>
                      详细信息
                    </h4>
                    <div
                      className={`grid grid-cols-2 gap-2 text-xs ${textSecondary}`}
                    >
                      <div>文档路径: {selectedFile.docPath}</div>
                      <div>
                        来源:{" "}
                        {sourceLabels[selectedFile.source] ||
                          selectedFile.source ||
                          "未知"}
                      </div>
                      {selectedFile.updated_at > 0 && (
                        <div>
                          最后更新: {formatDateTime(selectedFile.updated_at)}
                        </div>
                      )}
                      {selectedFile.category && (
                        <div>分类: {selectedFile.category}</div>
                      )}
                    </div>

                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className={`text-xs font-medium ${textSecondary}`}
                        >
                          标签
                        </span>
                        {!editor.editingTags &&
                          selectedFile.tags &&
                          selectedFile.tags.length > 0 && (
                            <button
                              onClick={startEditTags}
                              className={`text-[10px] ${textSecondary} hover:text-gray-700 dark:hover:text-gray-300`}
                            >
                              编辑
                            </button>
                          )}
                      </div>

                      {editor.editingTags ? (
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            value={editor.editTagsInput}
                            onChange={(e) =>
                              setEditor({ editTagsInput: e.target.value })
                            }
                            placeholder="输入标签，用逗号分隔"
                            className={`w-full px-2 py-1 text-xs border rounded ${inputBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSaveTags();
                              }
                              if (e.key === "Escape")
                                setEditor({ editingTags: false });
                            }}
                            autoFocus
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleSaveTags}
                              className="px-2 py-0.5 text-[10px] bg-blue-600 text-white rounded"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => setEditor({ editingTags: false })}
                              className={`px-2 py-0.5 text-[10px] ${textSecondary} hover:text-gray-700 dark:hover:text-gray-300`}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedFile.tags && selectedFile.tags.length > 0 ? (
                            selectedFile.tags.map((tag, idx) => (
                              <button
                                key={idx}
                                onClick={() => {
                                  // KB-TAGSEARCH（2026-08-27）：派发 SEARCH_REQUEST，
                                  // hook 监听后执行真实搜索——此前只 setSearch 导致
                                  // 右侧误显示「未找到匹配文档」
                                  dispatchList({
                                    type: "SEARCH_REQUEST",
                                    query: tag,
                                  });
                                }}
                                title={`点击筛选: ${tag}`}
                                className={`px-2 py-0.5 text-[10px] rounded-full cursor-pointer transition-colors ${
                                  isDark
                                    ? "bg-blue-900/30 text-blue-400 hover:bg-blue-800/40"
                                    : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                                }`}
                              >
                                {tag}
                              </button>
                            ))
                          ) : (
                            <button
                              onClick={startEditTags}
                              className={`text-[10px] ${textSecondary} px-2 py-0.5 rounded border border-dashed ${borderColor} hover:opacity-80`}
                            >
                              + 添加标签
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 语义索引 Tab ── */}
        <div
          style={{ display: activeTab === "semantic" ? "flex" : "none" }}
          className="flex-1 overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto">
            <SemanticIndexPage />
          </div>
        </div>

        {/* ── FAQ Tab（P1-1 页内化） ── */}
        <div
          style={{ display: activeTab === "faq" ? "flex" : "none" }}
          className="flex-1 overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto">
            <FAQPage base={selectedBase ?? ""} isDark={isDark} />
          </div>
        </div>

        {/* ── 知识图谱 Tab（P1-1 页内化） ── */}
        <div
          style={{ display: activeTab === "graph" ? "flex" : "none" }}
          className="flex-1 overflow-hidden"
        >
          <GraphPage isDark={isDark} active={activeTab === "graph"} />
        </div>

        {/* ── 知识库设置 Tab（P1-1 页内化；D5：可操作 OCR 开关 + 只读说明） ── */}
        <div
          style={{ display: activeTab === "config" ? "flex" : "none" }}
          className="flex-1 overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 max-w-lg">
            <KnowledgeSettingsPanel isDark={isDark} />
          </div>
        </div>

        {/* ── 数据源 Tab（P1-1 页内化） ── */}
        <div
          style={{ display: activeTab === "datasources" ? "flex" : "none" }}
          className="flex-1 overflow-hidden"
        >
          <DataSourcePage isDark={isDark} />
        </div>
      </div>
    </div>
  );
}

// ── U3: MoreMenu 下拉组件 ──

interface DetailsMenuProps {
  isDark: boolean;
  onStartEdit: () => void;
  onSendToChat: () => void;
  onExportNotebook: () => void;
  onZipExport: () => void;
  onVersionHistory: () => void;
  onTrash: () => void;
  onDelete: () => void;
}

function DetailsMenu(props: DetailsMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const itemClass =
    "block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors";
  const btnClass =
    "px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors";

  function item(onClick: () => void, label: string, className = "") {
    return (
      <button
        onClick={() => {
          onClick();
          setOpen(false);
        }}
        className={`${itemClass} ${className}`}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      ref={ref}
      className="relative flex items-center gap-2 ml-4 flex-shrink-0"
    >
      <button
        onClick={props.onStartEdit}
        className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md"
      >
        编辑
      </button>
      <button onClick={() => setOpen(!open)} className={btnClass}>
        更多 ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-50 py-1">
          {item(props.onSendToChat, "发送到对话")}
          {item(props.onExportNotebook, "导出到 Notebook")}
          {item(props.onZipExport, "导出")}
          {item(props.onVersionHistory, "历史版本")}
          <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
          {item(props.onTrash, "回收", "text-orange-600 dark:text-orange-400")}
          {item(props.onDelete, "删除", "text-red-600 dark:text-red-400")}
        </div>
      )}
    </div>
  );
}

export default KnowledgePage;
