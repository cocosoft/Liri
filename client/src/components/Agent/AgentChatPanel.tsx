import { useState, useRef, useEffect } from "react";
import { agentService } from "../../services/agentService";

interface ChatEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface AgentChatPanelProps {
  taskId: string;
  taskName: string;
}

function AgentChatPanel({ taskId, taskName }: AgentChatPanelProps) {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatEntry = { role: "user", content: text, timestamp: Date.now() };
    setMessages((p) => [...p, userMsg]);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const reply = await agentService.sendChatMessage(taskId, text);
      setMessages((p) => [
        ...p,
        { role: "assistant", content: reply || "(无响应)", timestamp: Date.now() },
      ]);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="text-xs text-gray-400 dark:text-gray-500 mb-2 truncate">
        与 <span className="font-medium text-gray-600 dark:text-gray-300">{taskName}</span> 对话
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 mb-2 min-h-[200px] max-h-[360px] bg-gray-50 dark:bg-gray-800/50 rounded p-2 border border-gray-100 dark:border-gray-700">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">
            向 Agent 发送指令开始交互
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-xs ${
              m.role === "user"
                ? "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 ml-4"
                : "text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 rounded-lg p-2 mr-4"
            }`}
          >
            <div className="whitespace-pre-wrap break-words">{m.content}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              {new Date(m.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))}
        {sending && (
          <div className="text-xs text-gray-400 italic px-2">
            思考中<span className="animate-pulse">...</span>
          </div>
        )}
        {error && (
          <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-2">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-1">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="输入指令..."
          className="flex-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
          disabled={sending}
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
        >
          {sending ? "..." : "发送"}
        </button>
      </div>
    </div>
  );
}

export default AgentChatPanel;
