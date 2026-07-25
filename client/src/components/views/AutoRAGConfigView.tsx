import { useTheme } from "../../hooks/useTheme";
import { AutoRAGPanel } from "../Knowledge/Settings/AutoRAGPanel";

export function AutoRAGConfigView() {
  const theme = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="flex flex-col h-full">
      <div
        className={`flex items-center px-4 py-2 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
      >
        <h2
          className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-800"}`}
        >
          RAG 配置
        </h2>
        <span
          className={`text-xs ml-2 ${isDark ? "text-gray-500" : "text-gray-400"}`}
        >
          检索通道权重、向量存储参数
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-6 max-w-lg">
        <AutoRAGPanel isDark={isDark} />
      </div>
    </div>
  );
}

export default AutoRAGConfigView;
