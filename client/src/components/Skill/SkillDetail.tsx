import type { Skill, SkillSource } from "../../services/skillService";
import MarkdownRenderer from "../ChatArea/MarkdownRenderer";

interface SkillDetailProps {
  skill: Skill;
  isDark: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
  /** SKILL.md 正文（去除 frontmatter，可选） */
  content?: string;
  /** YAML frontmatter 解析结果（可选） */
  frontmatter?: Record<string, unknown>;
  /** 关联文件路径列表（可选） */
  linkedFiles?: string[];
  /** 查看关联文件回调 */
  onViewFile?: (filePath: string) => void;
}

const STATUS_LABELS: Record<Skill["status"], string> = {
  enabled: "已启用",
  disabled: "已禁用",
  draft: "草稿",
};

const STATUS_COLORS: Record<Skill["status"], string> = {
  enabled:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  disabled: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  draft:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
};

// 来源标签配置
const SOURCE_LABELS: Record<SkillSource, string> = {
  builtin: "内置",
  official: "官方",
  third_party: "第三方",
  user: "用户",
  project: "项目",
  plugin: "插件",
  mcp: "MCP",
  bundled: "捆绑",
};

function SkillDetail({
  skill,
  isDark,
  onEdit,
  onDelete,
  onToggleStatus,
  content,
  frontmatter,
  linkedFiles,
  onViewFile,
}: SkillDetailProps) {
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const PARAMETER_TYPE_LABELS: Record<Skill["parameters"][0]["type"], string> =
    {
      string: "字符串",
      number: "数字",
      boolean: "布尔值",
      array: "数组",
      object: "对象",
    };

  return (
    <div
      className={`p-6 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
    >
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2
              className={`text-xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              {skill.name}
            </h2>
            {skill.version && (
              <span
                className={`px-2 py-0.5 rounded text-xs ${isDark ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-600"}`}
              >
                v{skill.version}
              </span>
            )}
            {skill.modified && (
              <span className="text-xs text-yellow-500" title="已修改">
                ✎ 已修改
              </span>
            )}
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[skill.status]}`}
            >
              {STATUS_LABELS[skill.status]}
            </span>
          </div>
          <p
            className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            {skill.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleStatus}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              skill.status === "enabled"
                ? isDark
                  ? "bg-yellow-900/30 text-yellow-400 hover:bg-yellow-800/30"
                  : "bg-yellow-50 text-yellow-600 hover:bg-yellow-100"
                : isDark
                  ? "bg-green-900/30 text-green-400 hover:bg-green-800/30"
                  : "bg-green-50 text-green-600 hover:bg-green-100"
            }`}
          >
            {skill.status === "enabled" ? "禁用" : "启用"}
          </button>
          <button
            onClick={onEdit}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              isDark
                ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            编辑
          </button>
          <button
            onClick={onDelete}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              isDark
                ? "bg-red-900/30 text-red-400 hover:bg-red-800/30"
                : "bg-red-50 text-red-600 hover:bg-red-100"
            }`}
          >
            删除
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div
          className={`p-4 rounded-lg ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
        >
          <h3
            className={`text-sm font-medium mb-3 ${isDark ? "text-gray-300" : "text-gray-700"}`}
          >
            基本信息
          </h3>
          <div className="space-y-2">
            {skill.source && (
              <div className="flex items-center justify-between">
                <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                  来源
                </span>
                <span className={isDark ? "text-gray-200" : "text-gray-800"}>
                  {SOURCE_LABELS[skill.source]} ({skill.source})
                </span>
              </div>
            )}
            {/* 致谢区域：展示作者、许可证与致谢信息 */}
            {frontmatter && (frontmatter.author || frontmatter.license || frontmatter.acknowledgements) ? (
              <div className={`mt-3 pt-3 border-t ${isDark ? "border-gray-700" : "border-gray-200"}`}>
                <h4 className={`text-xs font-medium mb-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                  致谢
                </h4>
                {frontmatter.author ? (
                  <div className="flex items-center justify-between">
                    <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                      作者
                    </span>
                    <span className={isDark ? "text-gray-200" : "text-gray-800"}>
                      {String(frontmatter.author as string)}
                    </span>
                  </div>
                ) : null}
                {frontmatter.license ? (
                  <div className="flex items-center justify-between">
                    <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                      许可证
                    </span>
                    <span className={isDark ? "text-gray-200" : "text-gray-800"}>
                      {String(frontmatter.license as string)}
                    </span>
                  </div>
                ) : null}
                {frontmatter.acknowledgements ? (
                  <div className={`mt-2 text-xs leading-relaxed whitespace-pre-wrap ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                    {String(frontmatter.acknowledgements as string)}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                分类
              </span>
              <span className={isDark ? "text-gray-200" : "text-gray-800"}>
                {skill.category}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                创建时间
              </span>
              <span className={isDark ? "text-gray-200" : "text-gray-800"}>
                {formatDate(skill.createdAt)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                更新时间
              </span>
              <span className={isDark ? "text-gray-200" : "text-gray-800"}>
                {formatDate(skill.updatedAt)}
              </span>
            </div>
          </div>
        </div>

        <div
          className={`p-4 rounded-lg ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
        >
          <h3
            className={`text-sm font-medium mb-3 ${isDark ? "text-gray-300" : "text-gray-700"}`}
          >
            使用统计
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                使用次数
              </span>
              <span className={isDark ? "text-gray-200" : "text-gray-800"}>
                {skill.usageCount}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                最后使用
              </span>
              <span className={isDark ? "text-gray-200" : "text-gray-800"}>
                {skill.lastUsedAt ? formatDate(skill.lastUsedAt) : "从未使用"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {skill.parameters.length > 0 && (
        <div
          className={`mt-6 p-4 rounded-lg ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
        >
          <h3
            className={`text-sm font-medium mb-3 ${isDark ? "text-gray-300" : "text-gray-700"}`}
          >
            参数列表 ({skill.parameters.length})
          </h3>
          <div className="space-y-2">
            {skill.parameters.map((param) => (
              <div
                key={param.name}
                className={`p-3 rounded-lg ${isDark ? "bg-gray-800" : "bg-white"} border ${isDark ? "border-gray-700" : "border-gray-200"}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}
                  >
                    {param.name}
                  </span>
                  {param.required && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-xs ${isDark ? "bg-red-900/30 text-red-400" : "bg-red-100 text-red-600"}`}
                    >
                      必填
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${isDark ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-600"}`}
                  >
                    {PARAMETER_TYPE_LABELS[param.type]}
                  </span>
                  {param.default !== undefined && (
                    <span
                      className={isDark ? "text-gray-400" : "text-gray-500"}
                    >
                      默认: {JSON.stringify(param.default)}
                    </span>
                  )}
                </div>
                {param.description && (
                  <p
                    className={`text-sm mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {param.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 技能内容（SKILL.md Markdown 渲染） */}
      {content && (
        <details className="mt-6" open>
          <summary
            className={`cursor-pointer text-sm font-medium mb-3 ${isDark ? "text-gray-300" : "text-gray-700"}`}
          >
            技能内容 (SKILL.md)
          </summary>
          {frontmatter && Object.keys(frontmatter).length > 0 && (
            <details
              className={`mb-3 p-3 rounded-lg ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
            >
              <summary
                className={`cursor-pointer text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                元数据 (Frontmatter)
              </summary>
              <pre
                className={`mt-2 text-xs overflow-x-auto ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {JSON.stringify(frontmatter, null, 2)}
              </pre>
            </details>
          )}
          <div
            className={`p-4 rounded-lg border ${isDark ? "bg-gray-900 border-gray-700" : "bg-white border-gray-200"} markdown-body`}
          >
            <MarkdownRenderer content={content} />
          </div>
        </details>
      )}

      {/* 关联文件列表 */}
      {linkedFiles && linkedFiles.length > 0 && onViewFile && (
        <div className="mt-6">
          <h3
            className={`text-sm font-medium mb-3 ${isDark ? "text-gray-300" : "text-gray-700"}`}
          >
            关联文件 ({linkedFiles.length})
          </h3>
          <div className="space-y-1">
            {linkedFiles.map((file) => (
              <button
                key={file}
                onClick={() => onViewFile(file)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                  isDark
                    ? "text-gray-300 hover:bg-gray-700"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                <svg
                  className="w-4 h-4 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="truncate">{file}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default SkillDetail;
