import type {
  Skill,
  SkillStatus,
  SkillSource,
} from "../../services/skillService";

interface SkillListProps {
  skills: Skill[];
  isDark: boolean;
  onSelect: (skill: Skill) => void;
  selectedId?: string | null;
}

const STATUS_LABELS: Record<SkillStatus, string> = {
  enabled: "启用",
  disabled: "禁用",
  draft: "草稿",
};

const STATUS_COLORS: Record<SkillStatus, string> = {
  enabled:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  disabled: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  draft:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
};

// 来源配置：颜色圆点 + 标签
const SOURCE_CONFIG: Record<
  SkillSource,
  { label: string; dotColor: string; tagColor: string }
> = {
  builtin: {
    label: "内置",
    dotColor: "bg-blue-500",
    tagColor:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  },
  official: {
    label: "官方",
    dotColor: "bg-indigo-500",
    tagColor:
      "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  },
  third_party: {
    label: "第三方",
    dotColor: "bg-orange-500",
    tagColor:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  },
  user: {
    label: "用户",
    dotColor: "bg-green-500",
    tagColor:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  },
  project: {
    label: "项目",
    dotColor: "bg-purple-500",
    tagColor:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  },
  plugin: {
    label: "插件",
    dotColor: "bg-orange-500",
    tagColor:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  },
  mcp: {
    label: "MCP",
    dotColor: "bg-cyan-500",
    tagColor:
      "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  },
  bundled: {
    label: "捆绑",
    dotColor: "bg-gray-500",
    tagColor: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  },
};

function SkillList({ skills, isDark, onSelect, selectedId }: SkillListProps) {
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (skills.length === 0) {
    return (
      <div
        className={`text-center py-12 ${isDark ? "text-gray-400" : "text-gray-500"}`}
      >
        <svg
          className="w-12 h-12 mx-auto mb-3 opacity-50"
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
        <p>暂无技能</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {skills.map((skill) => (
        <div
          key={skill.id}
          onClick={() => onSelect(skill)}
          className={`p-4 rounded-lg border cursor-pointer transition-colors ${
            selectedId === skill.id
              ? isDark
                ? "bg-blue-900/30 border-blue-500"
                : "bg-blue-50 border-blue-500"
              : isDark
                ? "bg-gray-800 border-gray-700 hover:bg-gray-700"
                : "bg-white border-gray-200 hover:bg-gray-50"
          }`}
        >
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              {skill.source && (
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${SOURCE_CONFIG[skill.source].dotColor}`}
                  title={SOURCE_CONFIG[skill.source].label}
                />
              )}
              <h3
                className={`font-medium truncate ${isDark ? "text-gray-200" : "text-gray-800"}`}
              >
                {skill.name}
                {skill.modified && (
                  <span className="ml-1 text-xs text-yellow-500" title="已修改">
                    ✎
                  </span>
                )}
              </h3>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${STATUS_COLORS[skill.status]}`}
            >
              {STATUS_LABELS[skill.status]}
            </span>
          </div>
          <p
            className={`text-sm line-clamp-2 mb-2 ${isDark ? "text-gray-400" : "text-gray-600"}`}
          >
            {skill.description}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {skill.source && (
                <span
                  className={`px-2 py-0.5 rounded text-xs ${SOURCE_CONFIG[skill.source].tagColor}`}
                >
                  {SOURCE_CONFIG[skill.source].label}
                </span>
              )}
              <span
                className={`px-2 py-0.5 rounded text-xs ${
                  isDark
                    ? "bg-gray-700 text-gray-400"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {skill.category}
              </span>
              {skill.version && (
                <span
                  className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                >
                  v{skill.version}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
              >
                使用 {skill.usageCount} 次
              </span>
              <span
                className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
              >
                {formatDate(skill.updatedAt)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default SkillList;
