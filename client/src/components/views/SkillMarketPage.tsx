import { useEffect, useCallback, useState, useRef } from "react";
import { useConfigStore } from "../../stores/configStore";
import { useSkillMarketStore } from "../../stores/skillMarketStore";
import { useToastStore } from "../../stores/toastStore";
import type { ClawHubSkillMeta } from "../../services/skillMarketService";
import { skillMarketService } from "../../services/skillMarketService";
import { SkillDetailModal } from "./SkillDetailModal";
import ConfirmDialog from "../common/ConfirmDialog";

/** 来源过滤选项 */
const SOURCE_OPTIONS: {
  value: "all" | "clawhub" | "local" | "plugin" | "mcp";
  label: string;
  dotColor: string;
}[] = [
  { value: "all", label: "全部", dotColor: "" },
  { value: "clawhub", label: "ClawHub", dotColor: "bg-green-500" },
  { value: "local", label: "本地", dotColor: "bg-blue-500" },
  { value: "plugin", label: "插件", dotColor: "bg-purple-500" },
  { value: "mcp", label: "MCP", dotColor: "bg-cyan-500" },
];

function SkillMarketPage() {
  const { config } = useConfigStore();
  const isDark = config.theme === "dark";

  const {
    searchResults,
    recommended,
    installed,
    categories,
    availableSources,
    marketSource,
    isLoading,
    operatingId,
    error,
    updatingIds,
    searchMarket,
    loadInstalled,
    loadRecommended,
    loadCategories,
    loadSources,
    installSkill,
    uninstallSkill,
    updateSkill,
    updateAllSkills,
    toggleSkill,
    setSearchQuery,
    setSourceFilter,
    setMarketSource,
    categoryFilter,
    setCategoryFilter,
    isInstalled,
    isEnabled,
    getStats,
    hasUpdates,
    page,
    pageSize,
    setPage,
    addCustomSource,
    removeCustomSource,
  } = useSkillMarketStore();

  const sourceFilter = useSkillMarketStore((s) => s.sourceFilter);
  const { addToast } = useToastStore();

  const [selectedSkill, setSelectedSkill] = useState<ClawHubSkillMeta | null>(
    null,
  );
  const [showDetail, setShowDetail] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<string | null>(null);
  const [localSearch, setLocalSearch] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [browseActive, setBrowseActive] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");

  // ── 首次加载 ──────────────────────────────────────

  useEffect(() => {
    loadInstalled();
    loadRecommended();
    loadCategories();
    loadSources();
  }, [loadInstalled, loadRecommended, loadCategories, loadSources]);

  // ── 搜索防抖 ──────────────────────────────────────

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(localSearch);
      if (localSearch.trim()) {
        searchMarket(
          localSearch,
          categoryFilter !== "all" ? categoryFilter : undefined,
          marketSource || undefined,
        );
        setBrowseActive(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearch, categoryFilter, marketSource, setSearchQuery, searchMarket]);

  // ── 市场来源切换时自动刷新浏览 ────────────────────

  useEffect(() => {
    if (browseActive) {
      searchMarket(
        "",
        categoryFilter !== "all" ? categoryFilter : undefined,
        marketSource || undefined,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketSource]);

  const stats = getStats();
  const updatable = hasUpdates();

  // ── 带 Toast 的操作 ────────────────────────────────

  const handleInstall = useCallback(
    async (skillId: string) => {
      try {
        await installSkill(skillId);
        const name =
          searchResults.find((r) => r.skill.id === skillId)?.skill.name ??
          recommended.find((r) => r.skill.id === skillId)?.skill.name ??
          skillId;
        addToast("success", `"${name}" 安装成功`);
      } catch {
        addToast("error", "安装失败");
      }
    },
    [installSkill, searchResults, recommended, addToast],
  );

  const handleUninstall = useCallback(async () => {
    if (!uninstallTarget) return;
    try {
      await uninstallSkill(uninstallTarget);
      addToast("success", "卸载成功");
    } catch {
      addToast("error", "卸载失败");
    } finally {
      setUninstallTarget(null);
    }
  }, [uninstallTarget, uninstallSkill, addToast]);

  const handleToggle = useCallback(
    async (skillId: string, enabled: boolean) => {
      try {
        await toggleSkill(skillId, enabled);
        addToast("info", enabled ? "已启用" : "已禁用");
      } catch {
        addToast("error", "操作失败");
      }
    },
    [toggleSkill, addToast],
  );

  const handleUpdate = useCallback(
    async (skillId: string) => {
      try {
        await updateSkill(skillId);
        addToast("success", "更新成功");
      } catch {
        addToast("error", "更新失败");
      }
    },
    [updateSkill, addToast],
  );

  const handleBatchUpdate = useCallback(async () => {
    try {
      await updateAllSkills();
      addToast("success", "批量更新完成");
    } catch {
      addToast("error", "批量更新失败");
    }
  }, [updateAllSkills, addToast]);

  const handleShowDetail = (skill: ClawHubSkillMeta) => {
    setSelectedSkill(skill);
    setShowDetail(true);
  };

  // ── 导出技能 ──────────────────────────────────────

  const handleExport = useCallback(async () => {
    try {
      const data = await skillMarketService.exportAll();
      if (data.length === 0) {
        addToast("info", "没有可导出的已安装技能");
        return;
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pyapp-skills-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      addToast("success", `已导出 ${data.length} 个技能`);
    } catch {
      addToast("error", "导出失败");
    }
  }, [addToast]);

  // ── 导入技能 ──────────────────────────────────────

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsImporting(true);
      try {
        const text = await file.text();
        let skills: Array<{
          name: string;
          description?: string;
          category?: string;
        }>;

        if (file.name.endsWith(".json")) {
          skills = JSON.parse(text);
          if (!Array.isArray(skills)) {
            skills = [skills];
          }
        } else if (file.name.endsWith(".md")) {
          // Markdown 文件：提取第一个 # 标题作为技能名
          const nameMatch = text.match(/^#\s+(.+)/m);
          skills = [
            {
              name: (nameMatch?.[1] || file.name.replace(/\.md$/, ""))
                .replace(/\s+/g, "-")
                .toLowerCase(),
              description: text
                .slice(0, 200)
                .replace(/^#\s+.+\n/m, "")
                .trim(),
            },
          ];
        } else {
          addToast("error", "仅支持 .json 和 .md 文件");
          return;
        }

        await skillMarketService.importSkills(skills);
        await loadInstalled();
        addToast("success", `成功导入 ${skills.length} 个技能`);
      } catch (err) {
        addToast(
          "error",
          `导入失败: ${err instanceof Error ? err.message : "格式错误"}`,
        );
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [addToast, loadInstalled],
  );

  // ── 克隆技能 ──────────────────────────────────────

  const handleClone = useCallback(
    async (skillId: string) => {
      try {
        await skillMarketService.clone(skillId);
        await loadInstalled();
        addToast("success", "克隆成功");
      } catch {
        addToast("error", "克隆失败");
      }
    },
    [addToast, loadInstalled],
  );

  // ── 获取技能状态标签 ──────────────────────────────

  const getStatusBadge = (skillId: string) => {
    if (!isInstalled(skillId)) return null;
    const enabled = isEnabled(skillId);
    return (
      <span
        className={`px-2 py-0.5 text-xs rounded-full ${
          enabled
            ? isDark
              ? "bg-green-900/30 text-green-400"
              : "bg-green-100 text-green-700"
            : isDark
              ? "bg-gray-700 text-gray-400"
              : "bg-gray-100 text-gray-600"
        }`}
      >
        {enabled ? "已启用" : "已禁用"}
      </span>
    );
  };

  // ── 过滤来源 + 分类 ──────────────────────────────

  const filteredResults = searchResults.filter((r) => {
    if (
      sourceFilter !== "all" &&
      (r.source || "").toLowerCase() !== sourceFilter
    )
      return false;
    if (categoryFilter !== "all" && r.skill.category !== categoryFilter)
      return false;
    return true;
  });

  // ── 分页切片 ──────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(filteredResults.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedResults = filteredResults.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  // ── 渲染搜索结果行 ────────────────────────────────

  const renderResultRow = (result: (typeof filteredResults)[number]) => (
    <div
      key={result.skill.id}
      className="px-4 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
      onClick={() => handleShowDetail(result.skill)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDark ? "bg-gray-700" : "bg-gray-100"}`}
          >
            <svg
              className="w-5 h-5 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <div>
            <h4
              className={`font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              {result.skill.name}
            </h4>
            <p
              className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {result.skill.description}
            </p>
          </div>
        </div>
        <div className="mt-2 ml-13 flex items-center gap-4">
          <span
            className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            v{result.skill.version}
          </span>
          <span
            className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            作者: {result.skill.author}
          </span>
          {result.skill.category && (
            <span
              className={`px-2 py-0.5 text-xs rounded-full ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"}`}
            >
              {result.skill.category}
            </span>
          )}
          <span
            className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            来源: {result.source}
          </span>
        </div>
      </div>
      <div
        className="flex items-center gap-3 ml-4"
        onClick={(e) => e.stopPropagation()}
      >
        {getStatusBadge(result.skill.id)}
        {isInstalled(result.skill.id) ? (
          <div className="flex gap-2">
            <button
              onClick={() =>
                handleToggle(result.skill.id, !isEnabled(result.skill.id))
              }
              disabled={operatingId === result.skill.id}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                isEnabled(result.skill.id)
                  ? "bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              } disabled:opacity-50`}
            >
              {isEnabled(result.skill.id) ? "禁用" : "启用"}
            </button>
            <button
              onClick={() => handleClone(result.skill.id)}
              disabled={operatingId === result.skill.id}
              title="克隆此技能"
              className="px-3 py-1.5 text-sm rounded-lg bg-purple-100 hover:bg-purple-200 text-purple-700 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 dark:text-purple-400 transition-colors disabled:opacity-50"
            >
              克隆
            </button>
            <button
              onClick={() => setUninstallTarget(result.skill.id)}
              disabled={operatingId === result.skill.id}
              className="px-3 py-1.5 text-sm rounded-lg bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 transition-colors disabled:opacity-50"
            >
              卸载
            </button>
          </div>
        ) : (
          <button
            onClick={() => handleInstall(result.skill.id)}
            disabled={operatingId === result.skill.id}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              operatingId === result.skill.id
                ? "bg-blue-400 text-white cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {operatingId === result.skill.id ? "安装中..." : "安装"}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-5xl mx-auto p-6">
        {/* ── 标题 ── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1
              className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              技能市场
            </h1>
            <p
              className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              浏览和安装 ClawHub 生态技能
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.md"
              className="hidden"
              onChange={handleImportFile}
            />
            <button
              onClick={handleImportClick}
              disabled={isImporting}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                isDark
                  ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              } disabled:opacity-50`}
            >
              {isImporting ? "导入中..." : "导入"}
            </button>
            <button
              onClick={handleExport}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium ${
                isDark
                  ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              导出
            </button>
            {updatable && (
              <button
                onClick={handleBatchUpdate}
                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                  isDark
                    ? "bg-yellow-900/30 text-yellow-400 hover:bg-yellow-800/30 border border-yellow-600/30"
                    : "bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border border-yellow-200"
                }`}
              >
                更新全部
              </button>
            )}
            <button
              onClick={() => {
                loadInstalled();
                loadRecommended();
              }}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium ${
                isDark
                  ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              刷新
            </button>
          </div>
        </div>

        {/* ── 统计面板 ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            {
              label: "已安装",
              value: stats.installedTotal,
              color: "text-blue-600 dark:text-blue-400",
            },
            {
              label: "已启用",
              value: stats.installedEnabled,
              color: "text-green-600 dark:text-green-400",
            },
            {
              label: "已禁用",
              value: stats.installedDisabled,
              color: "text-gray-500 dark:text-gray-400",
            },
            {
              label: "可更新",
              value: stats.updatableCount,
              color: "text-yellow-600 dark:text-yellow-400",
            },
          ].map((item) => (
            <div
              key={item.label}
              className={`p-3 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
            >
              <div
                className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {item.label}
              </div>
              <div className={`text-xl font-bold mt-1 ${item.color}`}>
                {item.value}
              </div>
            </div>
          ))}
        </div>

        {/* ── 搜索 ── */}
        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          <div
            className={`flex-1 relative ${isDark ? "bg-gray-800" : "bg-white"} rounded-lg border ${isDark ? "border-gray-700" : "border-gray-300"}`}
          >
            <input
              type="text"
              value={localSearch}
              onChange={(e) => {
                setLocalSearch(e.target.value);
                if (e.target.value) setBrowseActive(false);
              }}
              placeholder="搜索技能..."
              className={`w-full px-4 py-2 text-sm outline-none rounded-lg ${isDark ? "bg-transparent text-white placeholder-gray-400" : "bg-white text-gray-900 placeholder-gray-500"}`}
            />
            <svg
              className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>

        {/* ── 市场来源选择器 + 浏览按钮 ── */}
        {availableSources.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span
              className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              市场:
            </span>
            <button
              onClick={() => {
                setMarketSource("");
                setBrowseActive(false);
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                !marketSource
                  ? isDark
                    ? "bg-blue-900/50 text-blue-300 border border-blue-600"
                    : "bg-blue-100 text-blue-700 border border-blue-300"
                  : isDark
                    ? "text-gray-400 hover:text-gray-200 border border-gray-700"
                    : "text-gray-600 hover:text-gray-900 border border-gray-200"
              }`}
            >
              全部
            </button>
            {availableSources.map((s) => {
              const isBuiltin = [
                "clawhub",
                "github",
                "hermes",
                "gitee",
                "skillhub",
              ].includes(s);
              return (
                <span key={s} className="inline-flex items-center gap-0.5">
                  <button
                    onClick={() => {
                      setMarketSource(s);
                      setBrowseActive(false);
                    }}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      marketSource === s
                        ? isDark
                          ? "bg-blue-900/50 text-blue-300 border border-blue-600"
                          : "bg-blue-100 text-blue-700 border border-blue-300"
                        : isDark
                          ? "text-gray-400 hover:text-gray-200 border border-gray-700"
                          : "text-gray-600 hover:text-gray-900 border border-gray-200"
                    } ${!isBuiltin ? "rounded-r-none" : ""}`}
                  >
                    {s === "clawhub"
                      ? "ClawHub"
                      : s === "github"
                        ? "GitHub"
                        : s === "hermes"
                          ? "Hermes"
                          : s === "gitee"
                            ? "Gitee"
                            : s === "skillhub"
                              ? "SkillHub"
                              : s}
                  </button>
                  {!isBuiltin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCustomSource(s);
                      }}
                      className={`px-1 py-1 rounded-md rounded-l-none text-xs border-l-0 transition-colors ${
                        isDark
                          ? "text-gray-500 hover:text-red-400 border border-gray-700"
                          : "text-gray-400 hover:text-red-500 border border-gray-200"
                      }`}
                      title={`移除 ${s}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
            <button
              onClick={async () => {
                setBrowseActive(true);
                setLocalSearch("");
                await searchMarket("", undefined, marketSource || undefined);
              }}
              disabled={isLoading}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                isLoading
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                  : isDark
                    ? "bg-green-900/30 text-green-400 hover:bg-green-800/30 border border-green-600/30"
                    : "bg-green-50 text-green-700 hover:bg-green-100 border border-green-200"
              }`}
            >
              {isLoading && browseActive ? "加载中..." : "浏览市场"}
            </button>
            {/* 添加自定义源 */}
            <button
              onClick={() => setShowAddSource(!showAddSource)}
              className={`inline-flex items-center px-1.5 py-1 rounded-md text-xs font-medium transition-colors ${
                isDark
                  ? "text-gray-400 hover:text-gray-200 border border-dashed border-gray-600"
                  : "text-gray-500 hover:text-gray-800 border border-dashed border-gray-300"
              }`}
              title="添加自定义市场"
            >
              {showAddSource ? "−" : "+"}
            </button>
          </div>
        )}

        {/* ── 自定义源添加表单 ── */}
        {showAddSource && (
          <div
            className={`flex flex-wrap items-end gap-2 mb-3 p-3 rounded-lg border ${isDark ? "bg-gray-800 border-gray-600" : "bg-gray-50 border-gray-300"}`}
          >
            <input
              type="text"
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
              placeholder="名称 (如 modelscope)"
              className={`px-2 py-1 text-xs rounded border ${isDark ? "bg-gray-700 border-gray-600 text-white placeholder-gray-500" : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"}`}
            />
            <input
              type="text"
              value={newSourceUrl}
              onChange={(e) => setNewSourceUrl(e.target.value)}
              placeholder="API 地址 (如 https://modelscope.cn/api/v1)"
              className={`flex-1 min-w-[200px] px-2 py-1 text-xs rounded border ${isDark ? "bg-gray-700 border-gray-600 text-white placeholder-gray-500" : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"}`}
            />
            <button
              onClick={async () => {
                if (!newSourceName.trim() || !newSourceUrl.trim()) return;
                await addCustomSource(
                  newSourceName.trim(),
                  newSourceUrl.trim(),
                );
                setNewSourceName("");
                setNewSourceUrl("");
                setShowAddSource(false);
                setBrowseActive(true);
                await searchMarket("", undefined, newSourceName.trim());
              }}
              disabled={!newSourceName.trim() || !newSourceUrl.trim()}
              className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                isDark
                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              } disabled:opacity-50`}
            >
              添加
            </button>
          </div>
        )}

        {/* ── 分类过滤按钮组 ── */}
        {categories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <button
              onClick={() => setCategoryFilter("all")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                categoryFilter === "all"
                  ? isDark
                    ? "bg-blue-900/50 text-blue-300 border border-blue-600"
                    : "bg-blue-100 text-blue-700 border border-blue-300"
                  : isDark
                    ? "text-gray-400 hover:text-gray-200 border border-gray-700"
                    : "text-gray-600 hover:text-gray-900 border border-gray-200"
              }`}
            >
              全部
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() =>
                  setCategoryFilter(cat.id === categoryFilter ? "all" : cat.id)
                }
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  categoryFilter === cat.id
                    ? isDark
                      ? "bg-blue-900/50 text-blue-300 border border-blue-600"
                      : "bg-blue-100 text-blue-700 border border-blue-300"
                    : isDark
                      ? "text-gray-400 hover:text-gray-200 border border-gray-700"
                      : "text-gray-600 hover:text-gray-900 border border-gray-200"
                }`}
              >
                {cat.capability || cat.id}
                {cat.count > 0 && (
                  <span
                    className={`text-[10px] ${isDark ? "text-gray-500" : "text-gray-400"}`}
                  >
                    {cat.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── 来源过滤按钮组 ── */}
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSourceFilter(opt.value)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                sourceFilter === opt.value
                  ? isDark
                    ? "bg-blue-900/50 text-blue-300 border border-blue-600"
                    : "bg-blue-100 text-blue-700 border border-blue-300"
                  : isDark
                    ? "text-gray-400 hover:text-gray-200 border border-gray-700"
                    : "text-gray-600 hover:text-gray-900 border border-gray-200"
              }`}
            >
              {opt.dotColor && (
                <span
                  className={`inline-block w-2 h-2 rounded-full ${opt.dotColor}`}
                />
              )}
              {opt.label}
            </button>
          ))}
        </div>

        {/* ── 错误提示 ── */}
        {error && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm ${isDark ? "bg-red-900/30 text-red-400 border border-red-800" : "bg-red-50 text-red-600 border border-red-200"}`}
          >
            {error}
          </div>
        )}

        {/* ── 主内容区 ── */}
        {localSearch.trim() || browseActive ? (
          // ── 搜索/浏览结果 ──
          <div
            className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
          >
            {isLoading ? (
              <div className="p-8 text-center text-gray-400">搜索中...</div>
            ) : filteredResults.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                未找到匹配的技能
              </div>
            ) : (
              <>
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedResults.map(renderResultRow)}
                </div>
                {/* 分页控件 */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 py-3 border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => setPage(Math.max(1, page - 1))}
                      disabled={page <= 1}
                      className="px-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      上一页
                    </button>
                    <span
                      className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {safePage} / {totalPages} （共 {filteredResults.length}{" "}
                      项）
                    </span>
                    <button
                      onClick={() => setPage(Math.min(totalPages, page + 1))}
                      disabled={page >= totalPages}
                      className="px-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      下一页
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          // ── 首页发现区 ──
          <div className="space-y-6">
            {/* 推荐技能 */}
            {recommended.length > 0 && (
              <div>
                <h2
                  className={`text-sm font-semibold mb-3 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  推荐技能
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {recommended.map((r) => (
                    <div
                      key={r.skill.id}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                        isDark
                          ? "bg-gray-800 border-gray-700 hover:bg-gray-700"
                          : "bg-white border-gray-200 hover:bg-gray-50"
                      }`}
                      onClick={() => handleShowDetail(r.skill)}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? "bg-gray-700" : "bg-gray-100"}`}
                        >
                          <svg
                            className="w-4 h-4 text-gray-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M13 10V3L4 14h7v7l9-11h-7z"
                            />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3
                            className={`text-sm font-medium truncate ${isDark ? "text-gray-200" : "text-gray-800"}`}
                          >
                            {r.skill.name}
                          </h3>
                          <span
                            className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                          >
                            {r.skill.author} · v{r.skill.version}
                          </span>
                        </div>
                      </div>
                      <p
                        className={`text-xs line-clamp-2 mb-3 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {r.skill.description}
                      </p>
                      <div onClick={(e) => e.stopPropagation()}>
                        {isInstalled(r.skill.id) ? (
                          <div className="flex items-center justify-between">
                            {getStatusBadge(r.skill.id)}
                            <div className="flex gap-2">
                              <button
                                onClick={() =>
                                  handleToggle(
                                    r.skill.id,
                                    !isEnabled(r.skill.id),
                                  )
                                }
                                disabled={operatingId === r.skill.id}
                                className={`px-2 py-1 text-xs rounded transition-colors ${
                                  isEnabled(r.skill.id)
                                    ? "bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300"
                                    : "bg-blue-600 hover:bg-blue-700 text-white"
                                } disabled:opacity-50`}
                              >
                                {isEnabled(r.skill.id) ? "禁用" : "启用"}
                              </button>
                              <button
                                onClick={() => setUninstallTarget(r.skill.id)}
                                disabled={operatingId === r.skill.id}
                                className="px-2 py-1 text-xs rounded bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 transition-colors disabled:opacity-50"
                              >
                                卸载
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleInstall(r.skill.id)}
                            disabled={operatingId === r.skill.id}
                            className={`w-full py-1.5 text-xs rounded-lg font-medium transition-colors ${
                              operatingId === r.skill.id
                                ? "bg-blue-400 text-white cursor-not-allowed"
                                : "bg-blue-600 hover:bg-blue-700 text-white"
                            }`}
                          >
                            {operatingId === r.skill.id ? "安装中..." : "安装"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 已安装技能 */}
            {installed.length > 0 && (
              <div>
                <h2
                  className={`text-sm font-semibold mb-3 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  已安装技能 ({installed.length})
                </h2>
                <div
                  className={`rounded-lg border divide-y ${isDark ? "bg-gray-800 border-gray-700 divide-gray-700" : "bg-white border-gray-200 divide-gray-200"}`}
                >
                  {installed.map((s) => (
                    <div
                      key={s.meta.id}
                      className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isDark ? "bg-gray-700" : "bg-gray-100"}`}
                        >
                          <svg
                            className="w-4 h-4 text-gray-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M13 10V3L4 14h7v7l9-11h-7z"
                            />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-sm font-medium truncate ${isDark ? "text-gray-200" : "text-gray-800"}`}
                            >
                              {s.meta.name}
                            </span>
                            {s.hasUpdate && (
                              <span
                                className={`px-1.5 py-0.5 text-xs rounded-full flex-shrink-0 ${
                                  isDark
                                    ? "bg-yellow-900/30 text-yellow-400"
                                    : "bg-yellow-100 text-yellow-700"
                                }`}
                              >
                                有更新
                              </span>
                            )}
                            {s.enabled ? (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0"
                                title="已启用"
                              />
                            ) : (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0"
                                title="已禁用"
                              />
                            )}
                          </div>
                          <span
                            className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                          >
                            v{s.meta.version} · {s.meta.author}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {s.hasUpdate && (
                          <button
                            onClick={() => handleUpdate(s.meta.id)}
                            disabled={updatingIds.has(s.meta.id)}
                            className={`px-2 py-1 text-xs rounded transition-colors ${
                              isDark
                                ? "bg-yellow-900/30 text-yellow-400 hover:bg-yellow-800/30"
                                : "bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                            }`}
                          >
                            {updatingIds.has(s.meta.id) ? "更新中..." : "更新"}
                          </button>
                        )}
                        <button
                          onClick={() => handleToggle(s.meta.id, !s.enabled)}
                          disabled={operatingId === s.meta.id}
                          className={`px-2 py-1 text-xs rounded transition-colors ${
                            s.enabled
                              ? "bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300"
                              : "bg-blue-600 hover:bg-blue-700 text-white"
                          } disabled:opacity-50`}
                        >
                          {s.enabled ? "禁用" : "启用"}
                        </button>
                        <button
                          onClick={() => handleClone(s.meta.id)}
                          disabled={operatingId === s.meta.id}
                          title="克隆此技能"
                          className="px-2 py-1 text-xs rounded bg-purple-100 hover:bg-purple-200 text-purple-700 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 dark:text-purple-400 transition-colors disabled:opacity-50"
                        >
                          克隆
                        </button>
                        <button
                          onClick={() => setUninstallTarget(s.meta.id)}
                          disabled={operatingId === s.meta.id}
                          className="px-2 py-1 text-xs rounded bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 transition-colors disabled:opacity-50"
                        >
                          卸载
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 完全空状态（无推荐无已安装） */}
            {recommended.length === 0 && installed.length === 0 && (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">🔍</div>
                <p
                  className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  输入关键词搜索 ClawHub 技能市场
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 详情弹窗 ── */}
      {showDetail && selectedSkill && (
        <SkillDetailModal
          skill={selectedSkill}
          isInstalled={isInstalled(selectedSkill.id)}
          isEnabled={isEnabled(selectedSkill.id)}
          installing={operatingId === selectedSkill.id}
          onClose={() => {
            setShowDetail(false);
            setSelectedSkill(null);
          }}
          onInstall={() => handleInstall(selectedSkill.id)}
          onUninstall={async () => {
            try {
              await uninstallSkill(selectedSkill.id);
              addToast("success", "卸载成功");
              setShowDetail(false);
              setSelectedSkill(null);
            } catch {
              addToast("error", "卸载失败");
            }
          }}
          onToggle={(enabled) => handleToggle(selectedSkill.id, enabled)}
        />
      )}

      {/* ── 卸载确认对话框 ── */}
      <ConfirmDialog
        open={uninstallTarget !== null}
        title="卸载技能"
        message={`确定要卸载此技能吗？此操作不可撤销。`}
        confirmText="卸载"
        variant="danger"
        onConfirm={handleUninstall}
        onCancel={() => setUninstallTarget(null)}
      />
    </div>
  );
}

export default SkillMarketPage;
