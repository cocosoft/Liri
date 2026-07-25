import { useState, useEffect } from "react";
import { useKnowledgeStore } from "../../stores/knowledgeStore";
import { knowledgeService } from "../../services/knowledgeService";
import { useTheme } from "../../hooks/useTheme";
import { FAQPage } from "../Knowledge/FAQ/FAQPage";
import { Loader2 } from "lucide-react";
import type { KnowledgeBase } from "../../types";

export function FAQView() {
  const { isDark } = useTheme();
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [selectedBase, setSelectedBase] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    knowledgeService.listBases()
      .then((b) => { setBases(b); if (b.length > 0) setSelectedBase(b[0]!.name); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (bases.length === 0) {
    return (
      <div className={`flex items-center justify-center h-full ${isDark ? "text-gray-400" : "text-gray-500"}`}>
        <p className="text-sm">暂无知识库，请先在知识库页面创建</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 知识库选择器 */}
      <div className={`flex items-center gap-2 px-4 py-2 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}>
        <span className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>知识库:</span>
        <select
          value={selectedBase}
          onChange={(e) => setSelectedBase(e.target.value)}
          className={`text-xs rounded px-2 py-1 border ${
            isDark
              ? "bg-gray-800 border-gray-700 text-gray-300"
              : "bg-white border-gray-200 text-gray-700"
          }`}
        >
          {bases.map((b) => (
            <option key={b.name} value={b.name}>{b.label}</option>
          ))}
        </select>
      </div>

      {/* FAQ 主内容 */}
      <div className="flex-1 overflow-hidden">
        <FAQPage base={selectedBase} isDark={isDark} />
      </div>
    </div>
  );
}
