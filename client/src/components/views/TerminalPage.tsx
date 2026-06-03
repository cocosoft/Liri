import { useState, useEffect, useRef, useCallback } from "react";
import { http } from "../../services/httpClient";

interface TerminalLine {
  id: string;
  type: "input" | "output" | "error";
  content: string;
  timestamp: number;
}

interface CommandResult {
  success: boolean;
  output: string;
  error: string;
}

interface BackendCommand {
  name: string;
  description: string;
  aliases: string[];
  argumentHint: string;
  userInvocable: boolean;
}

function TerminalPage() {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isExecuting, setIsExecuting] = useState(false);
  const [cwd, setCwd] = useState("~");
  const [backendCommands, setBackendCommands] = useState<BackendCommand[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadBackendCommands();
    addLine("欢迎使用 Liri 终端", "output");
    addLine("输入 help 查看可用命令", "output");
    addLine("", "output");
  }, []);

  const loadBackendCommands = async () => {
    try {
      const cmds = await http.get<BackendCommand[]>("/v1/commands");
      setBackendCommands(cmds);
    } catch {
      // 静默失败，help 命令仍会展示本地帮助
    }
  };

  useEffect(() => {
    terminalRef.current?.scrollTo(0, terminalRef.current.scrollHeight);
  }, [lines]);

  const addLine = useCallback((content: string, type: TerminalLine["type"]) => {
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        type,
        content,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const executeBackendCommand = async (
    command: string,
  ): Promise<CommandResult> => {
    try {
      const result = await http.post<CommandResult>("/v1/commands/execute", {
        command,
      });
      return result;
    } catch (error) {
      return {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : "网络错误",
      };
    }
  };

  const executeCommand = async (cmd: string) => {
    if (!cmd.trim()) return;

    addLine(`❯ ${cmd}`, "input");
    setHistory((prev) => [cmd, ...prev].slice(0, 50));
    setHistoryIndex(-1);

    const trimmedCmd = cmd.trim();
    setIsExecuting(true);

    // 处理 cd 命令（客户端维护目录状态）
    if (trimmedCmd.startsWith("cd ")) {
      const args = trimmedCmd.split(/\s+/).slice(1);
      const target = args[0];
      if (target === "..") {
        setCwd((prev) =>
          prev === "~" ? "~" : prev.split("/").slice(0, -1).join("/") || "~",
        );
      } else if (target === "~" || target === "/") {
        setCwd("~");
      } else {
        setCwd((prev) => `${prev === "~" ? "" : prev}/${target}`);
      }
      addLine("", "output");
      setIsExecuting(false);
      return;
    }

    // 处理 clear 命令
    if (trimmedCmd === "clear" || trimmedCmd === "/clear") {
      setLines([]);
      setIsExecuting(false);
      return;
    }

    // 处理 pwd 命令
    if (trimmedCmd === "pwd" || trimmedCmd === "/pwd") {
      addLine(cwd === "~" ? "/home/user" : cwd, "output");
      setIsExecuting(false);
      return;
    }

    // 处理 date 命令
    if (trimmedCmd === "date" || trimmedCmd === "/date") {
      addLine(new Date().toLocaleString("zh-CN"), "output");
      setIsExecuting(false);
      return;
    }

    // 处理 whoami 命令
    if (trimmedCmd === "whoami" || trimmedCmd === "/whoami") {
      addLine("user", "output");
      setIsExecuting(false);
      return;
    }

    // 处理 help 命令：展示后端可用命令
    if (trimmedCmd === "help" || trimmedCmd === "/help") {
      addLine("可用命令:", "output");
      addLine("  cd <目录>      切换工作目录", "output");
      addLine("  clear          清屏", "output");
      addLine("  pwd            显示当前目录", "output");
      addLine("  date           显示当前时间", "output");
      addLine("  whoami         显示当前用户", "output");
      addLine("  help           显示此帮助", "output");
      if (backendCommands.length > 0) {
        addLine("", "output");
        addLine("后端命令:", "output");
        backendCommands.forEach((cmd) => {
          const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : "";
          addLine(`  ${cmd.name}${hint}    ${cmd.description}`, "output");
        });
      }
      addLine("", "output");
      setIsExecuting(false);
      return;
    }

    // 其他命令发送到后端执行
    const result = await executeBackendCommand(trimmedCmd);

    if (result.success) {
      if (result.output) {
        const outputLines = result.output.split("\n");
        outputLines.forEach((line: string) => {
          addLine(line, "output");
        });
      }
    } else {
      addLine(result.error || "Command execution failed", "error");
    }

    addLine("", "output");
    setIsExecuting(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isExecuting) {
      executeCommand(input);
      setInput("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput("");
      }
    }
  };

  const focusInput = () => {
    inputRef.current?.focus();
  };

  const getPrompt = () => {
    const user = "user";
    const host = "pyapp";
    const dir = cwd === "~" ? "~" : cwd.split("/").pop() || "~";
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
            {line.type === "input" ? (
              <span className="text-green-400">{line.content}</span>
            ) : line.type === "error" ? (
              <span className="text-red-400">{line.content}</span>
            ) : (
              <span className="text-gray-300">{line.content}</span>
            )}
          </div>
        ))}
      </div>

      <div className="px-4 py-3 bg-gray-900 border-t border-gray-800">
        <div className="flex items-center">
          <span className="text-green-400 font-mono text-sm mr-2">
            {getPrompt()}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isExecuting}
            className="flex-1 bg-transparent text-white font-mono text-sm outline-none"
            autoFocus
            placeholder={isExecuting ? "执行中..." : ""}
          />
        </div>
      </div>
    </div>
  );
}

export default TerminalPage;
