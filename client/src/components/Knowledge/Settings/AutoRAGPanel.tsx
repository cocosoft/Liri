import { useState, useEffect, useCallback, memo } from "react";
import { knowledgeConfigService } from "../../../services/knowledgeConfigService";
import type { KnowledgeConfigData } from "../../../types/knowledge";
import { Loader2, Save } from "lucide-react";

interface AutoRAGPanelProps {
  isDark: boolean;
}

export const AutoRAGPanel = memo(function AutoRAGPanel({
  isDark,
}: AutoRAGPanelProps) {
  const [_config, setConfig] = useState<KnowledgeConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edited, setEdited] = useState<KnowledgeConfigData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    knowledgeConfigService
      .get()
      .then((c) => {
        setConfig(c);
        setEdited(c);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = useCallback(async () => {
    if (!edited) return;
    setSaving(true);
    setError("");
    try {
      const updated = await knowledgeConfigService.update(edited);
      setConfig(updated);
      setEdited(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [edited]);

  const updateSearch = useCallback(
    (key: string, value: number) => {
      if (!edited) return;
      setEdited({
        ...edited,
        search: { ...edited.search, [key]: value },
      });
    },
    [edited],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={18} className="animate-spin text-gray-400" />
      </div>
    );
  }

  const s = edited?.search;
  const vs = edited?.vectorStore;

  return (
    <div className="space-y-5 p-1">
      {error && (
        <div className="text-xs text-red-500 bg-red-500/10 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* 搜索权重 */}
      <fieldset>
        <legend
          className={`text-xs font-semibold mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          检索通道权重
        </legend>
        <div className="space-y-3">
          <label className="flex items-center justify-between">
            <span
              className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              关键词权重
            </span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={s?.keywordWeight ?? 0.4}
                onChange={(e) =>
                  updateSearch("keywordWeight", parseFloat(e.target.value))
                }
                className="w-24"
              />
              <span
                className={`text-xs w-8 text-right font-mono ${isDark ? "text-gray-300" : "text-gray-600"}`}
              >
                {s?.keywordWeight ?? 0.4}
              </span>
            </div>
          </label>
          <label className="flex items-center justify-between">
            <span
              className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              语义权重
            </span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={s?.semanticWeight ?? 0.6}
                onChange={(e) =>
                  updateSearch("semanticWeight", parseFloat(e.target.value))
                }
                className="w-24"
              />
              <span
                className={`text-xs w-8 text-right font-mono ${isDark ? "text-gray-300" : "text-gray-600"}`}
              >
                {s?.semanticWeight ?? 0.6}
              </span>
            </div>
          </label>
          <label className="flex items-center justify-between">
            <span
              className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              语义相似度阈值
            </span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={s?.semanticThreshold ?? 0.3}
                onChange={(e) =>
                  updateSearch("semanticThreshold", parseFloat(e.target.value))
                }
                className="w-24"
              />
              <span
                className={`text-xs w-8 text-right font-mono ${isDark ? "text-gray-300" : "text-gray-600"}`}
              >
                {s?.semanticThreshold ?? 0.3}
              </span>
            </div>
          </label>
          <label className="flex items-center justify-between">
            <span
              className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              知识文档加成
            </span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={s?.knowledgeDocBoost ?? 0.5}
                onChange={(e) =>
                  updateSearch("knowledgeDocBoost", parseFloat(e.target.value))
                }
                className="w-24"
              />
              <span
                className={`text-xs w-8 text-right font-mono ${isDark ? "text-gray-300" : "text-gray-600"}`}
              >
                {s?.knowledgeDocBoost ?? 0.5}
              </span>
            </div>
          </label>
        </div>
      </fieldset>

      {/* 向量存储 */}
      <fieldset>
        <legend
          className={`text-xs font-semibold mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          向量存储
        </legend>
        <div className="space-y-3">
          <label className="flex items-center justify-between">
            <span
              className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              Top-K
            </span>
            <input
              type="number"
              min={1}
              max={50}
              value={vs?.topK ?? 10}
              onChange={(e) =>
                setEdited(
                  edited
                    ? {
                        ...edited,
                        vectorStore: {
                          ...(vs ?? { type: "jsonl", topK: 10, minScore: 0.3 }),
                          topK: parseInt(e.target.value) || 10,
                        },
                      }
                    : null,
                )
              }
              className={`text-xs w-16 px-2 py-1 rounded border text-right ${isDark ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200"}`}
            />
          </label>
          <label className="flex items-center justify-between">
            <span
              className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              最低相似度
            </span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={vs?.minScore ?? 0.3}
              onChange={(e) =>
                setEdited(
                  edited
                    ? {
                        ...edited,
                        vectorStore: {
                          ...(vs ?? { type: "jsonl", topK: 10, minScore: 0.3 }),
                          minScore: parseFloat(e.target.value) || 0.3,
                        },
                      }
                    : null,
                )
              }
              className={`text-xs w-16 px-2 py-1 rounded border text-right ${isDark ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200"}`}
            />
          </label>
        </div>
      </fieldset>

      {/* 编译 */}
      <fieldset>
        <legend
          className={`text-xs font-semibold mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          编译
        </legend>
        <label className="flex items-center justify-between">
          <span
            className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            每文件最大页数
          </span>
          <input
            type="number"
            min={1}
            max={20}
            value={edited?.compiler.maxPagesPerFile ?? 8}
            onChange={(e) =>
              setEdited(
                edited
                  ? {
                      ...edited,
                      compiler: {
                        ...edited.compiler,
                        maxPagesPerFile: parseInt(e.target.value) || 8,
                      },
                    }
                  : null,
              )
            }
            className={`text-xs w-16 px-2 py-1 rounded border text-right ${isDark ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200"}`}
          />
        </label>
      </fieldset>

      {/* 保存 */}
      <button
        onClick={handleSave}
        disabled={saving}
        className={`flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium transition-colors w-full justify-center ${
          saving ? "opacity-50 cursor-not-allowed" : ""
        } bg-blue-600 text-white hover:bg-blue-700`}
      >
        <Save size={12} />
        {saving ? "保存中..." : "保存配置"}
      </button>
    </div>
  );
});
