import { useState, useRef, useCallback } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useConfigStore } from '../../stores/configStore';
import { useAppStore } from '../../stores/appStore';
import { fileService } from '../../services/fileService';
import VoiceInputButton from '../VoiceInputButton';
import ModelSelector from './ModelSelector';

interface FileAttachment {
  name: string;
  size: number;
  data: string;
}

interface SlashCommand {
  key: string;
  label: string;
  description: string;
  action: () => void;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * 将 File 对象读取为 Base64 字符串
 */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function ChatInput() {
  const [input, setInput] = useState('');
  const [showCommands, setShowCommands] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  /**
   * 处理文件选择
   */
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: FileAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        alert(`文件 "${file.name}" 超过 20MB 限制，已跳过`);
        continue;
      }
      try {
        const data = await readFileAsBase64(file);
        newAttachments.push({ name: file.name, size: file.size, data });
      } catch {
        alert(`读取文件 "${file.name}" 失败`);
      }
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
    e.target.value = '';
  }, []);

  /**
   * 移除附件
   */
  const handleRemoveFile = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /**
   * 处理拖拽文件
   */
  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const processFiles = async () => {
      const newAttachments: FileAttachment[] = [];
      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          alert(`文件 "${file.name}" 超过 20MB 限制，已跳过`);
          continue;
        }
        try {
          const data = await readFileAsBase64(file);
          newAttachments.push({ name: file.name, size: file.size, data });
        } catch {
          alert(`读取文件 "${file.name}" 失败`);
        }
      }
      setAttachments((prev) => [...prev, ...newAttachments]);
    };
    processFiles();
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  /**
   * 格式化文件大小
   */
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /**
   * 发送消息，先上传附件
   */
  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!currentSession) return;

    const matched = slashCommands.find((cmd) => cmd.key === trimmed);
    if (matched) {
      matched.action();
      setInput('');
      return;
    }

    if (!trimmed && attachments.length === 0) return;

    setIsUploading(true);

    try {
      const uploadedPaths: string[] = [];

      for (const file of attachments) {
        const result = await fileService.uploadBase64(file.name, file.data);
        uploadedPaths.push(result.path);
      }

      let messageContent = trimmed;
      if (uploadedPaths.length > 0) {
        const fileRefs = uploadedPaths
          .map((p, i) => `[${attachments[i].name}](${p})`)
          .join(', ');
        messageContent = messageContent
          ? `${messageContent}\n\n附件: ${fileRefs}`
          : `上传文件: ${fileRefs}`;
      }

      if (messageContent) {
        await streamMessage(messageContent, currentSession.id);
      }

      setInput('');
      setShowCommands(false);
      setAttachments([]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      alert(`文件上传失败: ${errorMsg}\n\n可能原因：\n• 系统安全策略限制了对用户目录的访问\n• 磁盘空间不足\n\n系统会自动尝试使用项目目录作为备选存储位置。`);
    } finally {
      setIsUploading(false);
    }
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

  const isSending = isLoading || isUploading;

  return (
    <div
      className="p-4 border-t bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
      onDrop={handleFileDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="flex items-center gap-2 mb-2">
        <ModelSelector
          selectedModel={selectedModel}
          onModelChange={(modelId) => setConfig('model', modelId)}
        />
      </div>

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((file, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300"
            >
              <span className="truncate max-w-[120px]">{file.name}</span>
              <span className="text-blue-400 dark:text-blue-500">({formatFileSize(file.size)})</span>
              <button
                onClick={() => handleRemoveFile(i)}
                className="ml-0.5 text-blue-400 hover:text-blue-600 dark:hover:text-blue-200"
                title="移除"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div
        className={`relative flex space-x-3 rounded-lg transition-colors ${
          isDragOver ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/20' : ''
        }`}
      >
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
            disabled={!currentSession || isSending}
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

        <div className="flex flex-col gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!currentSession || isSending}
            className="p-2 text-gray-400 hover:text-blue-500 disabled:text-gray-300 dark:disabled:text-gray-600 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            title="上传文件"
          >
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <VoiceInputButton isDark={config.theme === 'dark'} />
          <button
            onClick={handleSubmit}
            disabled={!currentSession || isSending || (!input.trim() && attachments.length === 0)}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {isUploading ? '上传中...' : '发送'}
          </button>
        </div>
      </div>

      {(isLoading || isUploading) && (
        <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {isUploading ? '正在上传文件...' : '正在等待回复...'}
        </div>
      )}

      {isDragOver && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-blue-500 font-medium bg-white dark:bg-gray-800 px-4 py-2 rounded-lg shadow-lg">
            拖放文件以上传
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatInput;
