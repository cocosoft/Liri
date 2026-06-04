import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface XTermPanelProps {
  onReady?: (terminal: Terminal) => void;
}

export default function XTermPanel({ onReady }: XTermPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
      theme: {
        background: "#1a1a2e",
        foreground: "#e6e6e6",
        cursor: "#6c5ce7",
        selectionBackground: "#6c5ce744",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    // 自适应
    const handleResize = () => fitAddon.fit();
    handleResize();
    window.addEventListener("resize", handleResize);

    term.writeln("Liri 终端已就绪 (xterm.js)");
    term.write("$ ");

    let cmdBuffer = "";
    let cmdHistory: string[] = [];

    term.onData((data) => {
      const code = data.charCodeAt(0);

      if (code === 13) {
        // Enter
        term.write("\r\n");
        const cmd = cmdBuffer.trim();
        if (cmd) {
          cmdHistory.push(cmd);
            term.writeln(`执行: ${cmd}`);
          // 通过回调发送命令
          onReady?.(term);
        }
        cmdBuffer = "";
        term.write("$ ");
      } else if (code === 127) {
        // Backspace
        if (cmdBuffer.length > 0) {
          cmdBuffer = cmdBuffer.slice(0, -1);
          term.write("\b \b");
        }
      } else if (code === 27) {
        // ESC 序列（上下箭头等）
        // 简化处理，不拦截复杂 ANSI
      } else if (data.length === 1 && data >= " ") {
        cmdBuffer += data;
        term.write(data);
      }
    });

    terminalRef.current = term;

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full rounded border border-gray-700"
    />
  );
}
