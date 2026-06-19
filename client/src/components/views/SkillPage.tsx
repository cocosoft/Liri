import { useEffect, useState, useMemo } from "react";
import { useConfigStore } from "../../stores/configStore";
import { useSkillStore } from "../../stores/skillStore";
import type {
  Skill,
  SkillCreateData,
  SkillStatus,
  SkillSource,
  SkillContent,
} from "../../services/skillService";
import { skillService } from "../../services/skillService";
import SearchInput from "../common/SearchInput";
import ConfirmDialog from "../common/ConfirmDialog";
import SkillList from "../Skill/SkillList";
import SkillDetail from "../Skill/SkillDetail";
import SkillEditor from "../Skill/SkillEditor";
import SkillMarketModal from "./SkillMarketModal";

function SkillPage() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const {
    skills,
    total,
    selectedSkill,
    categories,
    error,
    loadSkills,
    loadCategories,
    createSkill,
    updateSkill,
    deleteSkill,
    enableSkill,
    disableSkill,
    setSelectedSkill,
  } = useSkillStore();

  const [sortBy, setSortBy] = useState<
    "createdAt" | "updatedAt" | "usageCount"
  >("updatedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<SkillStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SkillSource | null>(null);
  const [activeTab, setActiveTab] = useState<"local" | "official" | "third_party">("local");
  const [showMarket, setShowMarket] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const [skillContent, setSkillContent] = useState<SkillContent | null>(null);

  useEffect(() => {
    // 当 Tab 切换时同步更新 sourceFilter
    if (activeTab === "local") {
      setSourceFilter(null);
    } else {
      setSourceFilter(activeTab);
    }
  }, [activeTab]);

  useEffect(() => {
    loadSkills({
      sortBy,
      sortOrder,
      category: categoryFilter || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
    });
    loadCategories();
  }, [
    loadSkills,
    loadCategories,
    sortBy,
    sortOrder,
    categoryFilter,
    statusFilter,
  ]);

  // 搜索 + 来源过滤后的技能列表
  const filteredSkills = useMemo(() => {
    let result = skills;

    // 来源过滤
    if (sourceFilter) {
      result = result.filter((s) => s.source === sourceFilter);
    }

    // 搜索过滤
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q),
      );
    }

    return result;
  }, [skills, searchQuery, sourceFilter]);

  // 统计面板数据
  const stats = useMemo(
    () => ({
      total: skills.length,
      enabled: skills.filter((s) => s.status === "enabled").length,
      disabled: skills.filter((s) => s.status === "disabled").length,
      draft: skills.filter((s) => s.status === "draft").length,
    }),
    [skills],
  );

  const handleSelectSkill = (skill: Skill) => {
    setSelectedSkill(skill);
    setShowEditor(false);
    setEditingSkill(null);

    // 异步加载技能内容
    setSkillContent(null);
    skillService
      .getContent(skill.id)
      .then((content) => {
        setSkillContent(content);
      })
      .catch(() => {
        setSkillContent(null);
      });
  };

  const handleCreate = () => {
    setEditingSkill(null);
    setShowEditor(true);
    setSelectedSkill(null);
  };

  const handleEdit = () => {
    if (selectedSkill) {
      setEditingSkill(selectedSkill);
      setShowEditor(true);
    }
  };

  const handleSave = async (data: SkillCreateData | Partial<Skill>) => {
    if (editingSkill) {
      await updateSkill(editingSkill.id, data);
    } else {
      await createSkill(data as SkillCreateData);
    }
    setShowEditor(false);
    setEditingSkill(null);
    loadSkills({ sortBy, sortOrder });
  };

  const handleDelete = () => {
    if (selectedSkill) {
      setDeleteTarget(selectedSkill);
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleteTarget) {
      await deleteSkill(deleteTarget.id);
      setDeleteTarget(null);
      setSelectedSkill(null);
      loadSkills({ sortBy, sortOrder });
    }
  };

  const handleToggleStatus = async () => {
    if (selectedSkill) {
      if (selectedSkill.status === "enabled") {
        await disableSkill(selectedSkill.id);
      } else {
        await enableSkill(selectedSkill.id);
      }
      loadSkills({ sortBy, sortOrder });
      setSelectedSkill(null);
    }
  };

  const STATUS_OPTIONS: { value: SkillStatus | "all"; label: string }[] = [
    { value: "all", label: "全部状态" },
    { value: "enabled", label: "已启用" },
    { value: "disabled", label: "已禁用" },
    { value: "draft", label: "草稿" },
  ];

  return (
    <div
      className={`flex-1 overflow-hidden flex flex-col ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-7xl mx-auto w-full p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1
              className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              技能管理
            </h1>
            <p
              className={`mt-1 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              管理和配置系统技能，共 {total} 个
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMarket(true)}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                isDark
                  ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white"
              }`}
            >
              进入市场
            </button>
            <button
              onClick={handleCreate}
              className={`px-4 py-2 rounded-lg font-medium text-white transition-colors ${
                isDark
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              + 创建技能
            </button>
          </div>
        </div>

        {error && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm ${isDark ? "bg-red-900/30 text-red-400 border border-red-800" : "bg-red-50 text-red-600 border border-red-200"}`}
          >
            {error}
          </div>
        )}

        {/* 统计面板 */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            {
              label: "总数",
              value: stats.total,
              color: "text-blue-600 dark:text-blue-400",
            },
            {
              label: "已启用",
              value: stats.enabled,
              color: "text-green-600 dark:text-green-400",
            },
            {
              label: "已禁用",
              value: stats.disabled,
              color: "text-gray-600 dark:text-gray-400",
            },
            {
              label: "草稿",
              value: stats.draft,
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

        {/* 来源 Tab 栏 */}
        <div className="flex items-center gap-1 mb-4">
          {[
            { key: "local" as const, label: "系统技能", desc: "内置/用户/项目" },
            { key: "official" as const, label: "官方", desc: "官方发布" },
            { key: "third_party" as const, label: "第三方", desc: "社区来源" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? isDark
                    ? "bg-blue-900/50 text-blue-300 border border-blue-600"
                    : "bg-blue-100 text-blue-700 border border-blue-300"
                  : isDark
                    ? "text-gray-400 hover:text-gray-200 border border-gray-700 hover:bg-gray-800"
                    : "text-gray-600 hover:text-gray-900 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              <div>{tab.label}</div>
              <div className={`text-xs mt-0.5 ${activeTab === tab.key ? (isDark ? "text-blue-400" : "text-blue-500") : (isDark ? "text-gray-500" : "text-gray-400")}`}>
                {tab.desc}
              </div>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-3">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="搜索技能名称、描述或分类..."
            isDark={isDark}
            className="flex-1 min-w-[200px]"
          />
        </div>

        {/* 来源过滤按钮组 */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {[
            { source: null, label: "全部", dotColor: "" },
            {
              source: "builtin" as SkillSource,
              label: "内置",
              dotColor: "bg-blue-500",
            },
            {
              source: "official" as SkillSource,
              label: "官方",
              dotColor: "bg-indigo-500",
            },
            {
              source: "third_party" as SkillSource,
              label: "第三方",
              dotColor: "bg-orange-500",
            },
            {
              source: "user" as SkillSource,
              label: "用户",
              dotColor: "bg-green-500",
            },
            {
              source: "project" as SkillSource,
              label: "项目",
              dotColor: "bg-purple-500",
            },
            {
              source: "plugin" as SkillSource,
              label: "插件",
              dotColor: "bg-orange-500",
            },
            {
              source: "bundled" as SkillSource,
              label: "捆绑",
              dotColor: "bg-gray-500",
            },
          ].map((opt) => (
            <button
              key={String(opt.source)}
              onClick={() => setSourceFilter(opt.source)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                sourceFilter === opt.source
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

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className={`px-3 py-2 rounded-lg text-sm border ${
              isDark
                ? "bg-gray-700 border-gray-600 text-white"
                : "bg-white border-gray-300 text-gray-700"
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            <option value="">全部分类</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as SkillStatus | "all")
            }
            className={`px-3 py-2 rounded-lg text-sm border ${
              isDark
                ? "bg-gray-700 border-gray-600 text-white"
                : "bg-white border-gray-300 text-gray-700"
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(
                e.target.value as "createdAt" | "updatedAt" | "usageCount",
              )
            }
            className={`px-3 py-2 rounded-lg text-sm border ${
              isDark
                ? "bg-gray-700 border-gray-600 text-white"
                : "bg-white border-gray-300 text-gray-700"
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            <option value="updatedAt">按更新时间</option>
            <option value="createdAt">按创建时间</option>
            <option value="usageCount">按使用次数</option>
          </select>

          <button
            onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
            className={`px-3 py-2 rounded-lg text-sm border ${
              isDark
                ? "bg-gray-700 border-gray-600 text-white"
                : "bg-white border-gray-300 text-gray-700"
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            {sortOrder === "desc" ? "↓" : "↑"}
          </button>
        </div>

        {showEditor ? (
          <SkillEditor
            isDark={isDark}
            skill={editingSkill}
            categories={categories}
            onSave={handleSave}
            onCancel={() => {
              setShowEditor(false);
              setEditingSkill(null);
              if (selectedSkill) {
                setSelectedSkill(selectedSkill);
              }
            }}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <SkillList
                skills={filteredSkills}
                isDark={isDark}
                onSelect={handleSelectSkill}
                selectedId={selectedSkill?.id}
              />
            </div>

            <div>
              {selectedSkill ? (
                <>
                  {/* 移动端返回列表按钮 */}
                  <button
                    onClick={() => setSelectedSkill(null)}
                    className={`lg:hidden mb-3 flex items-center gap-1 text-sm ${isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-500"}`}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                    返回列表
                  </button>
                  <SkillDetail
                    skill={selectedSkill}
                    isDark={isDark}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onToggleStatus={handleToggleStatus}
                    content={skillContent?.content}
                    frontmatter={skillContent?.frontmatter}
                    linkedFiles={skillContent?.linkedFiles}
                    onViewFile={async (filePath) => {
                      try {
                        const fc = await skillService.getFileContent(
                          selectedSkill.id,
                          filePath,
                        );
                        setSkillContent((prev) =>
                          prev ? { ...prev, content: fc } : null,
                        );
                      } catch {
                        /* ignore */
                      }
                    }}
                  />
                </>
              ) : (
                <div
                  className={`h-full flex items-center justify-center rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
                >
                  <div
                    className={`text-center ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    <svg
                      className="w-16 h-16 mx-auto mb-3 opacity-50"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                    <p>选择一个技能查看详情</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 技能市场弹窗 */}
      {showMarket && <SkillMarketModal onClose={() => setShowMarket(false)} />}

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除技能"
        message={`确定要删除技能「${deleteTarget?.name ?? ""}」吗？此操作不可撤销。`}
        confirmText="删除"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default SkillPage;
