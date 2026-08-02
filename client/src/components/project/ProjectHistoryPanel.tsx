/**
 * 项目讨论记录面板 — 右侧「讨论记录」区（默认折叠）
 *
 * 以时间线摘要形式展示，点击展开单轮对话详情。
 */

import React, { useState } from 'react';
import { MessageCircle, ChevronDown, ChevronRight } from 'lucide-react';

interface HistoryTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface Props {
  projectId: string;
  /** 讨论记录数据（从 session messages 派生） */
  turns?: HistoryTurn[];
}

export const ProjectHistoryPanel: React.FC<Props> = ({
  projectId: _projectId,
  turns: _turns,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (!_turns || _turns.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-400 text-center">
        暂无讨论记录。
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1">
      <div
        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{expanded ? '收起' : '展开'}讨论记录</span>
      </div>

      {expanded && (
        <div className="space-y-1 pl-4">
          {_turns.map((turn) => (
            <div
              key={turn.id}
              className="text-xs border-l-2 border-gray-200 dark:border-gray-700 pl-2 py-0.5"
            >
              <div className="flex items-center gap-1 text-gray-400">
                <MessageCircle size={10} />
                <span>{turn.role === 'user' ? '你' : 'AI'}</span>
                <span className="ml-auto">{turn.timestamp}</span>
              </div>
              <div className="text-gray-600 dark:text-gray-400 truncate mt-0.5">
                {turn.content.slice(0, 40)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
