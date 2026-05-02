import { useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useSessionStore } from '../stores/sessionStore';

export function useKeyboard() {
  const { clearMessages } = useChatStore();
  const { createSession, sessions } = useSessionStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'n':
            e.preventDefault();
            createSession(`新会话 ${sessions.length + 1}`);
            break;
          case 'l':
            e.preventDefault();
            clearMessages();
            break;
        }
      }

      if (e.key === 'Escape') {
        const input = document.querySelector('textarea') as HTMLTextAreaElement;
        if (input) {
          input.blur();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearMessages, createSession, sessions.length]);
}