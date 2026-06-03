import { useEffect, useState } from "react";
import type { ModelInfo } from "../../types";
import { chatService } from "../../services/chatService";

interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
}

function ModelSelector({ selectedModel, onModelChange }: ModelSelectorProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const loadModels = async () => {
      setLoading(true);
      try {
        const remoteModels = await chatService.fetchModels();
        if (remoteModels.length > 0) {
          setModels(
            remoteModels.map((m) => ({
              id: m.id,
              name: m.name,
              provider: m.provider,
              type: "chat",
              context_length: 8192,
              enabled: true,
            })),
          );
        } else {
          setModels([
            {
              id: "pyapp-default",
              name: "Liri 默认",
              provider: "pyapp",
              type: "chat",
              context_length: 8192,
              enabled: true,
            },
          ]);
        }
      } catch {
        setModels([
          {
            id: "pyapp-default",
            name: "Liri 默认",
            provider: "pyapp",
            type: "chat",
            context_length: 8192,
            enabled: true,
          },
        ]);
      } finally {
        setLoading(false);
      }
    };
    loadModels();
  }, []);

  const selectedModelInfo = models.find((m) => m.id === selectedModel);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        {loading ? (
          <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-green-400" />
        )}
        <span className="max-w-24 truncate">
          {selectedModelInfo?.name || selectedModel || "选择模型"}
        </span>
        <svg
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-20 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
            <div className="p-2 border-b border-gray-100 dark:border-gray-700">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                选择模型
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {models.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-400">
                  {loading ? "加载中..." : "暂无可用的模型"}
                </div>
              ) : (
                models.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      onModelChange(model.id);
                      setOpen(false);
                    }}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                      selectedModel === model.id
                        ? "bg-blue-50 dark:bg-blue-900/20"
                        : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {model.name}
                        </span>
                        {selectedModel === model.id && (
                          <svg
                            className="w-3.5 h-3.5 text-blue-600 shrink-0"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {model.provider}
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                      {model.context_length < 10000
                        ? `${(model.context_length / 1000).toFixed(1)}K`
                        : `${(model.context_length / 1000).toFixed(0)}K`}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ModelSelector;
