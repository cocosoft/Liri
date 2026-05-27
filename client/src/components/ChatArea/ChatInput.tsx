import { useState } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useConfigStore } from '../../stores/configStore';
import { useAppStore } from '../../stores/appStore';
import ModelSelector from './ModelSelector';

interface SlashCommand {
  key: string;
  label: string;
  description: string;
  action: () => void;
}

function ChatInput() {
  const [input, setInput] = useState('');
  const [showCommands, setShowCommands] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const { streamMessage, isLoading, clearMessages } = useChatStore();
  const { currentSession } = useSessionStore();
  const { config, setConfig } = useConfigStore();
  const setActivePage = useAppStore((s) => s.setActivePage);

  const selectedModel = (config.model as string) || '';

  const slashCommands: SlashCommand[] = [
    { key: '/dashboard', label: '/dashboard', description: '打开仪表盘', action: () => setActivePage('dashboard') },
    { key: '/files', label: '/files', description: '打开文件浏览器', action: () => setActivePage('files') },
    { key: '/knowledge', label: '/knowledge', description: '打开知识库', action: () => setActivePage('knowledge') },
    { key: '/agent', label: '/agent', description: '打开 Agent 任务', action: () => setActivePage('agent') },
    { key: '/clear', label: '/clear', description: '清空聊天消息', action: () => { clearMessages(); setInput(''); } },
    { key: '/help', label: '/help', description: '显示可用命令', action: () => setShowCommands(true) },
  ];

  const filteredCommands = slashCommands.filter((cmd) =>
    cmd.key.startsWith(input.toLowerCase())
  );

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || !currentSession) return;

    const matched = slashCommands.find((cmd) => cmd.key === trimmed);
    if (matched) {
      matched.action();
      setInput('');
      return;
    }

    await streamMessage(trimmed, currentSession.id);
    setInput('');
    setShowCommands(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommands && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCommandIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCommandIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const cmd = filteredCommands[commandIndex];
        if (cmd) {
          setInput(cmd.key + ' ');
          setCommandIndex(0);
          setShowCommands(false);
        }
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    setShowCommands(value.startsWith('/') && value.indexOf(' ') === -1);
    setCommandIndex(0);
  };

  return (
    <div className="p-4 border-t bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 mb-2">
        <ModelSelector
          selectedModel={selectedModel}
          onModelChange={(modelId) => setConfig('model', modelId)}
        />
      </div>

      <div className="relative flex space-x-3">
        <div className="flex-1 relative">
          <textarea
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              currentSession
                ? '输入 / 查看命令，按 Enter 发送...'
                : '请先选择或创建会话'
            }
            disabled={!currentSession || isLoading}
            className="w-full p-3 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
            rows={2}
          />

          {showCommands && filteredCommands.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
              {filteredCommands.map((cmd, idx) => (
                <button
                  key={cmd.key}
                  onClick={() => {
                    setInput(cmd.key + ' ');
                    setShowCommands(false);
                  }}
                  onMouseEnter={() => setCommandIndex(idx)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                    idx === commandIndex
                      ? 'bg-blue-50 dark:bg-blue-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
                >
                  <span className="font-mono text-blue-600 dark:text-blue-400 font-medium">
                    {cmd.label}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">{cmd.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={!currentSession || isLoading || !input.trim()}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors font-medium"
        >
          发送
        </button>
      </div>

      {isLoading && (
        <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">正在等待回复...</div>
      )}
    </div>
  );
}

export default ChatInput;
