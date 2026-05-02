import { useEffect, useState } from 'react';
import { Tool } from '../../types';

function ToolPanel() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const loadTools = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/tools');
        if (response.ok) {
          const data = await response.json();
          setTools(data);
        }
      } catch {
        setTools([]);
      }
    };
    loadTools();
  }, []);

  return (
    <div
      className={`bg-gray-900 text-white transition-all duration-300 ${
        isExpanded ? 'w-64' : 'w-12'
      }`}
    >
      <div className="p-2 border-b border-gray-700">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full text-center py-2 hover:bg-gray-800 rounded"
        >
          {isExpanded ? '◀' : '▶'}
        </button>
      </div>

      {isExpanded && (
        <div className="p-4">
          <h3 className="text-lg font-bold mb-4">工具</h3>
          <div className="space-y-2">
            {tools.map((tool) => (
              <div
                key={tool.name}
                className={`p-3 rounded ${
                  tool.enabled ? 'bg-gray-800' : 'bg-gray-700 opacity-50'
                }`}
              >
                <div className="font-medium">{tool.name}</div>
                <div className="text-xs text-gray-400 mt-1">
                  {tool.description}
                </div>
                <div className="flex gap-2 mt-2">
                  {tool.read_only && (
                    <span className="text-xs px-2 py-0.5 bg-green-600 rounded">
                      只读
                    </span>
                  )}
                  {tool.destructive && (
                    <span className="text-xs px-2 py-0.5 bg-red-600 rounded">
                      危险
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {tools.length === 0 && (
            <p className="text-gray-400 text-sm">暂无工具</p>
          )}
        </div>
      )}
    </div>
  );
}

export default ToolPanel;