import { useState, useEffect, useRef } from 'react';

interface TerminalLine {
  id: number;
  type: 'input' | 'output' | 'error';
  content: string;
  timestamp: number;
}

function TerminalPage() {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isExecuting, setIsExecuting] = useState(false);
  const [cwd, setCwd] = useState('~');
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const lineIdRef = useRef(0);

  useEffect(() => {
    addLine('欢迎使用 PY_APP 终端模拟器', 'output');
    addLine('输入 help 查看可用命令', 'output');
    addLine('', 'output');
  }, []);

  useEffect(() => {
    terminalRef.current?.scrollTo(0, terminalRef.current.scrollHeight);
  }, [lines]);

  const addLine = (content: string, type: TerminalLine['type']) => {
    lineIdRef.current++;
    setLines((prev) => [...prev, {
      id: lineIdRef.current,
      type,
      content,
      timestamp: Date.now(),
    }]);
  };

  const executeCommand = async (cmd: string) => {
    if (!cmd.trim()) return;

    addLine(`❯ ${cmd}`, 'input');
    setHistory((prev) => [cmd, ...prev].slice(0, 50));
    setHistoryIndex(-1);

    const trimmedCmd = cmd.trim().toLowerCase();
    const args = cmd.trim().split(/\s+/).slice(1);
    setIsExecuting(true);

    await new Promise((resolve) => setTimeout(resolve, 200));

    if (trimmedCmd === 'help') {
      addLine('可用命令:', 'output');
      addLine('  help     - 显示帮助信息', 'output');
      addLine('  clear    - 清除终端', 'output');
      addLine('  pwd      - 显示当前目录', 'output');
      addLine('  cd <dir> - 切换目录', 'output');
      addLine('  ls       - 列出文件', 'output');
      addLine('  echo     - 显示文本', 'output');
      addLine('  date     - 显示当前时间', 'output');
      addLine('  whoami   - 显示当前用户', 'output');
      addLine('  env      - 显示环境变量', 'output');
    } else if (trimmedCmd === 'clear') {
      setLines([]);
    } else if (trimmedCmd === 'pwd') {
      addLine(cwd === '~' ? '/home/user' : cwd, 'output');
    } else if (trimmedCmd.startsWith('cd ')) {
      const target = args[0];
      if (target === '..') {
        setCwd((prev) => prev === '~' ? '~' : prev.split('/').slice(0, -1).join('/') || '~');
      } else if (target === '~' || target === '/') {
        setCwd('~');
      } else {
        setCwd((prev) => `${prev}/${target}`);
      }
      addLine('', 'output');
    } else if (trimmedCmd === 'ls') {
      addLine('drwxr-xr-x  2 user  staff   160 May 28 10:00 .', 'output');
      addLine('drwxr-xr-x  4 user  staff   160 May 28 10:00 ..', 'output');
      addLine('-rw-r--r--  1 user  staff  1024 May 28 10:00 README.md', 'output');
      addLine('drwxr-xr-x  3 user  staff   160 May 28 10:00 src', 'output');
      addLine('-rw-r--r--  1 user  staff  2048 May 28 10:00 package.json', 'output');
    } else if (trimmedCmd.startsWith('echo ')) {
      addLine(args.join(' '), 'output');
    } else if (trimmedCmd === 'date') {
      addLine(new Date().toLocaleString('zh-CN'), 'output');
    } else if (trimmedCmd === 'whoami') {
      addLine('user', 'output');
    } else if (trimmedCmd === 'env') {
      addLine('PATH=/usr/local/bin:/usr/bin:/bin', 'output');
      addLine('HOME=/home/user', 'output');
      addLine('SHELL=/bin/bash', 'output');
      addLine('TERM=xterm-256color', 'output');
    } else if (trimmedCmd.startsWith('npm ') || trimmedCmd.startsWith('npx ') || trimmedCmd.startsWith('git ')) {
      addLine(`模拟执行: ${cmd}`, 'output');
      addLine('(终端模拟器仅用于预览，实际命令执行由后端处理)', 'output');
    } else {
      addLine(`bash: ${trimmedCmd.split(' ')[0]}: command not found`, 'error');
    }

    setIsExecuting(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isExecuting) {
      executeCommand(input);
      setInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  const focusInput = () => {
    inputRef.current?.focus();
  };

  const getPrompt = () => {
    const user = 'user';
    const host = 'pyapp';
    const dir = cwd === '~' ? '~' : cwd.split('/').pop() || '~';
    return `${user}@${host}:${dir}$ `;
  };

  return (
    <div
      className="flex-1 overflow-hidden flex flex-col bg-black"
      onClick={focusInput}
    >
      <div className="px-4 py-2 bg-gray-900 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-sm">终端</span>
          <div className="flex gap-1">
            <span className="w-3 h-3 rounded-full bg-red-500" />
            <span className="w-3 h-3 rounded-full bg-yellow-500" />
            <span className="w-3 h-3 rounded-full bg-green-500" />
          </div>
        </div>
        <button
          onClick={() => setLines([])}
          className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded"
        >
          清除
        </button>
      </div>

      <div
        ref={terminalRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-sm"
        onClick={focusInput}
      >
        {lines.map((line) => (
          <div key={line.id} className="whitespace-pre-wrap">
            {line.type === 'input' ? (
              <span className="text-green-400">{line.content}</span>
            ) : line.type === 'error' ? (
              <span className="text-red-400">{line.content}</span>
            ) : (
              <span className="text-gray-300">{line.content}</span>
            )}
          </div>
        ))}
      </div>

      <div className="px-4 py-3 bg-gray-900 border-t border-gray-800">
        <div className="flex items-center">
          <span className="text-green-400 font-mono text-sm mr-2">{getPrompt()}</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isExecuting}
            className="flex-1 bg-transparent text-white font-mono text-sm outline-none"
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}

export default TerminalPage;