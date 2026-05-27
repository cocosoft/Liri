import { useEffect, useState, useMemo } from 'react';
import { toolService } from '../../services/toolService';
import type { Tool } from '../../types';

function ToolPanel() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const loadTools = async () => {
      try {
        const data = await toolService.list();
        setTools(data);
      } catch {
        setTools([]);
      }
    };
    loadTools();
  }, []);

  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return tools;
    const q = searchQuery.toLowerCase();
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
    );
  }, [tools, searchQuery]);

  return (
    <div
      className={`bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 transition-all duration-300 ${
        isExpanded ? 'w-72' : 'w-12'
      }`}
    >
      <div className="p-2 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full text-center py-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-600 dark:text-gray-400"
        >
          {isExpanded ? '◀' : '▶'}
        </button>
      </div>

      {isExpanded && (
        <div className="p-3 overflow-y-auto h-[calc(100%-44px)]">
          <h3 className="text-base font-semibold mb-3 text-gray-900 dark:text-gray-100">
            工具
            <span className="ml-2 text-xs text-gray-400 font-normal">
              {tools.length}
            </span>
          </h3>

          <input
            type="text"
            placeholder="搜索工具..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-2 py-1.5 mb-3 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          <div className="space-y-2">
            {filteredTools.map((tool) => (
              <div
                key={tool.name}
                className={`p-2.5 rounded border ${
                  tool.enabled
                    ? 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                    : 'bg-gray-100 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-60'
                }`}
              >
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
                  {tool.name}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                  {tool.description}
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  {tool.read_only && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded">
                      只读
                    </span>
                  )}
                  {tool.destructive && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded">
                      危险
                    </span>
                  )}
                  {!tool.enabled && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                      禁用
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {filteredTools.length === 0 && (
            <p className="text-gray-400 dark:text-gray-500 text-sm text-center mt-4">
              {searchQuery ? '无匹配工具' : '暂无工具'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default ToolPanel;
