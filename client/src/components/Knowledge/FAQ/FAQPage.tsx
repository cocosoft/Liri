import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, FileInput, Trash2 } from "lucide-react";
import { faqService } from "../../../services/faqService";
import type { FAQEntry, FAQImportReport } from "../../../types/faq";
import { FAQList } from "./FAQList";
import { FAQEditor } from "./FAQEditor";
import { FAQSearchBar } from "./FAQSearchBar";
import { FAQCategoryFilter } from "./FAQCategoryFilter";
import { FAQImportModal } from "./FAQImportModal";

interface FAQPageProps {
  base: string;
  isDark: boolean;
}

export function FAQPage({ base, isDark }: FAQPageProps) {
  const [entries, setEntries] = useState<FAQEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showEditor, setShowEditor] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FAQEntry | undefined>();
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catData] = await Promise.all([
        faqService.categories(base).catch(() => [] as string[]),
      ]);
      setCategories(catData ?? []);

      if (searchQuery) {
        const result = await faqService.search(base, searchQuery);
        setEntries(result.entries);
      } else {
        const result = await faqService.list(base, {
          category: category || undefined,
        });
        setEntries(result.entries);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [base, searchQuery, category]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = useCallback(
    async (data: {
      question: string;
      answer: string;
      similarQuestions: string[];
      tags: string[];
      category: string;
      recommended: boolean;
    }) => {
      await faqService.create(base, data);
      await load();
    },
    [base, load],
  );

  const handleUpdate = useCallback(
    async (data: {
      question: string;
      answer: string;
      similarQuestions: string[];
      tags: string[];
      category: string;
      recommended: boolean;
    }) => {
      if (!editingEntry) return;
      await faqService.update(base, editingEntry.id, data);
      setEditingEntry(undefined);
      await load();
    },
    [base, editingEntry, load],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await faqService.delete(base, id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await load();
    },
    [base, load],
  );

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    await faqService.batchDelete(base, Array.from(selectedIds));
    setSelectedIds(new Set());
    await load();
  }, [base, selectedIds, load]);

  const handleImport = useCallback(
    async (format: "csv" | "json", data: string): Promise<FAQImportReport> => {
      const report = await faqService.import(base, format, data);
      await load();
      return report;
    },
    [base, load],
  );

  const handleRetryEmbed = useCallback(async (id: string) => {
    // 待后端补充 re-embed 端点后实现
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map((e) => e.id)));
    }
  }, [selectedIds, entries]);

  return (
    <div className="flex h-full">
      {/* 左侧分类过滤 */}
      <div
        className={`w-40 shrink-0 p-3 border-r ${isDark ? "border-gray-700" : "border-gray-200"}`}
      >
        <FAQCategoryFilter
          categories={categories}
          selected={category}
          onSelect={setCategory}
          isDark={isDark}
        />
      </div>

      {/* 右侧主区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 工具栏 */}
        <div
          className={`flex items-center justify-between px-4 py-2.5 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          <div className="flex items-center gap-2">
            <FAQSearchBar onSearch={setSearchQuery} isDark={isDark} />
            {searchQuery && (
              <span
                className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
              >
                {entries.length} 条结果
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {selectedIds.size > 0 && (
              <button
                onClick={handleBatchDelete}
                className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                  isDark
                    ? "text-red-400 hover:bg-red-500/10"
                    : "text-red-500 hover:bg-red-50"
                }`}
              >
                <Trash2 size={12} />
                删除 ({selectedIds.size})
              </button>
            )}
            <button
              onClick={() => setShowImport(true)}
              className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                isDark
                  ? "text-gray-300 hover:bg-gray-800 border border-gray-700"
                  : "text-gray-600 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              <FileInput size={12} />
              导入
            </button>
            <button
              onClick={() => {
                setEditingEntry(undefined);
                setShowEditor(true);
              }}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <Plus size={12} />
              新建
            </button>
          </div>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <div
              className={`text-center py-12 text-sm ${isDark ? "text-gray-500" : "text-gray-400"}`}
            >
              加载中...
            </div>
          ) : (
            <FAQList
              entries={entries}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleAll={toggleAll}
              onEdit={(e) => {
                setEditingEntry(e);
                setShowEditor(true);
              }}
              onDelete={handleDelete}
              onRetryEmbed={handleRetryEmbed}
              isDark={isDark}
            />
          )}
        </div>
      </div>

      {/* 编辑器弹窗 */}
      {showEditor && (
        <FAQEditor
          isDark={isDark}
          base={base}
          entry={editingEntry}
          onSave={editingEntry ? handleUpdate : handleCreate}
          onClose={() => {
            setShowEditor(false);
            setEditingEntry(undefined);
          }}
        />
      )}

      {/* 导入弹窗 */}
      {showImport && (
        <FAQImportModal
          isDark={isDark}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
