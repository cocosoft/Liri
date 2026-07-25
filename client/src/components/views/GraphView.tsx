import { useTheme } from "../../hooks/useTheme";
import { GraphPage } from "../Knowledge/Graph/GraphPage";

export function GraphView() {
  const { isDark } = useTheme();

  return (
    <div className="flex flex-col h-full">
      <div
        className={`flex items-center px-4 py-2 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
      >
        <h2
          className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-800"}`}
        >
          知识图谱
        </h2>
        <span
          className={`text-xs ml-2 ${isDark ? "text-gray-500" : "text-gray-400"}`}
        >
          编译知识库后自动生成实体关系图
        </span>
      </div>
      <div className="flex-1 overflow-hidden">
        <GraphPage isDark={isDark} />
      </div>
    </div>
  );
}
