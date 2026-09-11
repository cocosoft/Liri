import { AlertTriangle, XCircle } from "lucide-react";
import type { OntologySchemaIssue } from "../../../types/project";

interface OntologyIssueListProps {
  issues: OntologySchemaIssue[];
  isDark: boolean;
}

/**
 * 本体校验问题列表（本体页与表单模式共用，避免两处各写一份渲染）
 *
 * 文案面向普通用户：文件 + 条目序号 + 说明；技术细节留在服务端日志。
 */
export function OntologyIssueList({
  issues,
  isDark,
}: OntologyIssueListProps) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {issues.map((issue, index) => {
        const isError = issue.level === "error";
        const toneClass = isError
          ? isDark
            ? "text-red-400"
            : "text-red-600"
          : isDark
            ? "text-amber-400"
            : "text-amber-600";
        return (
          <li
            key={`${issue.file}-${issue.item ?? 0}-${index}`}
            className={`text-xs flex gap-2 ${toneClass}`}
          >
            {isError ? (
              <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            )}
            <span>
              <span className="font-mono">
                {issue.file}
                {issue.item ? ` #${issue.item}` : ""}
              </span>
              {" — "}
              {issue.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
