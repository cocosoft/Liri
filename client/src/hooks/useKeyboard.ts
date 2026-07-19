import { useEffect, useCallback } from "react";
import { useChatStore } from "../stores/chatStore";
import { useSessionStore } from "../stores/sessionStore";
import { useNavigationStore } from "../stores/navigationStore";

const shortcutMap: Record<
  string,
  { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }
> = {
  "new-session": { key: "n", ctrl: true, shift: true },
  "clear-messages": { key: "l", ctrl: true },
  "toggle-dashboard": { key: "d", ctrl: true, shift: true },
  "toggle-settings": { key: ",", ctrl: true },
  "focus-input": { key: "i", ctrl: true },
  "show-help": { key: "/", ctrl: true },
  "stop-generation": { key: "s", ctrl: true, shift: true },
};

export type ShortcutAction =
  | "new-session"
  | "clear-messages"
  | "toggle-dashboard"
  | "toggle-settings"
  | "focus-input"
  | "show-help"
  | "stop-generation";

export function useKeyboard() {
  const { clearMessages } = useChatStore();
  const { createSession, sessions } = useSessionStore();
  const { activePage, setActivePage } = useNavigationStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
          e.preventDefault();
        }
        if (!e.ctrlKey && !e.metaKey) return;
      }

      const isCtrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (isCtrl && e.shiftKey && key === shortcutMap["new-session"].key) {
        e.preventDefault();
        createSession(`新会话 ${sessions.length + 1}`);
        setActivePage("chat");
        return;
      }

      if (isCtrl && !e.shiftKey && key === shortcutMap["clear-messages"].key) {
        e.preventDefault();
        clearMessages();
        return;
      }

      if (isCtrl && e.shiftKey && key === shortcutMap["toggle-dashboard"].key) {
        e.preventDefault();
        setActivePage(activePage === "dashboard" ? "chat" : "dashboard");
        return;
      }

      if (isCtrl && !e.shiftKey && key === shortcutMap["toggle-settings"].key) {
        e.preventDefault();
        const btn = document.querySelector(
          '[title="设置"]',
        ) as HTMLButtonElement;
        btn?.click();
        return;
      }

      if (isCtrl && !e.shiftKey && key === shortcutMap["focus-input"].key) {
        e.preventDefault();
        const textarea = document.querySelector(
          "textarea",
        ) as HTMLTextAreaElement;
        textarea?.focus();
        return;
      }

      if (isCtrl && !e.shiftKey && key === shortcutMap["show-help"].key) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-shortcut-help"));
        return;
      }

      // Ctrl+Shift+S：停止生成
      if (isCtrl && e.shiftKey && key === shortcutMap["stop-generation"].key) {
        e.preventDefault();
        useChatStore.getState().stopMessage();
        return;
      }
    },
    [clearMessages, createSession, sessions.length, activePage, setActivePage],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
