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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { streamMessage, isLoading, clearMessages } = useChatStore();
  const { currentSession, createSession } = useSessionStore();
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

    const matched = slashCommands.find((cmd) => cmd.key === trimmed);
    if (matched) {
      matched.action();
      setInput('');
      return;
    }

    if (!trimmed && attachments.length === 0) return;

    setIsUploading(true);

    try {
      let sessionId = currentSession?.id;
      
      if (!sessionId) {
        const newSession = await createSession('新会话');
        sessionId = newSession.id;
      }

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
        await streamMessage(messageContent, sessionId);
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
      className={`p-4 border-t bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 transition-colors ${
        isDragOver ? 'ring-2 ring-blue-400 ring-inset' : ''
      }`}
      onDrop={handleFileDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="max-w-4xl mx-auto">
        {/* 模型选择器 */}
        <div className="flex items-center gap-2 mb-3">
          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={(modelId) => setConfig('model', modelId)}
          />
        </div>

        {/* 附件列表 */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachments.map((file, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300"
              >
                <span className="w-6 h-6 bg-blue-100 dark:bg-blue-800 rounded flex items-center justify-center text-xs">📄</span>
                <span className="truncate max-w-[120px]">{file.name}</span>
                <span className="text-blue-400 dark:text-blue-500 text-xs">({formatFileSize(file.size)})</span>
                <button
                  onClick={() => handleRemoveFile(i)}
                  className="ml-1 p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800 rounded transition-colors"
                  title="移除"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 输入框区域 */}
        <div className="relative">
          {/* 命令提示 */}
          {showCommands && filteredCommands.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl overflow-hidden">
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                快捷命令
              </div>
              {filteredCommands.map((cmd, idx) => (
                <button
                  key={cmd.key}
                  onClick={() => {
                    setInput(cmd.key + ' ');
                    setShowCommands(false);
                  }}
                  onMouseEnter={() => setCommandIndex(idx)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
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

          {/* 输入框 */}
          <div className="flex items-end gap-3 bg-gray-100 dark:bg-gray-700 rounded-xl p-1.5">
            {/* 左侧按钮 */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!currentSession || isSending}
                className="p-2 text-gray-500 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:text-gray-400 dark:disabled:text-gray-600 rounded-lg transition-colors"
                title="上传文件"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>

            {/* 文本输入 */}
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  currentSession
                    ? '输入消息或 / 查看命令...'
                    : '请先选择或创建会话'
                }
                disabled={!currentSession || isSending}
                className="w-full px-3 py-2.5 bg-transparent resize-none focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 disabled:cursor-not-allowed"
                rows={1}
                style={{ minHeight: '40px', maxHeight: '200px' }}
              />
            </div>

            {/* 右侧按钮 */}
            <div className="flex items-center gap-1">
              <VoiceInputButton isDark={config.theme === 'dark'} />
              <button
                onClick={handleSubmit}
                disabled={!currentSession || isSending || (!input.trim() && attachments.length === 0)}
                className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium shadow-md hover:shadow-lg flex items-center gap-2"
              >
                {isUploading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>上传中</span>
                  </>
                ) : isLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>发送中</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    <span>发送</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 状态提示 */}
        {(isLoading || isUploading) && (
          <div className="mt-3 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>{isUploading ? '正在上传文件...' : '正在思考中...'}</span>
          </div>
        )}

        {/* 拖拽提示 */}
        {isDragOver && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-white dark:bg-gray-800 border-2 border-dashed border-blue-400 px-6 py-3 rounded-xl shadow-lg">
              <span className="text-blue-500 font-medium">放开放置文件</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatInput;
