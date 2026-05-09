import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from 'react';

export interface MailboxItem {
  id: string;
  type: 'notification' | 'message' | 'system' | 'error';
  title: string;
  content: string;
  timestamp: number;
  read: boolean;
  action?: () => void;
}

export interface MailboxContextType {
  items: MailboxItem[];
  addItem: (item: Omit<MailboxItem, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (id: string) => void;
  removeItem: (id: string) => void;
  clearAll: () => void;
  getUnreadCount: () => number;
}

const MailboxContext = createContext<MailboxContextType | undefined>(undefined);

export function MailboxProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<MailboxItem[]>([]);

  const addItem = useCallback(
    (item: Omit<MailboxItem, 'id' | 'timestamp' | 'read'>) => {
      const newItem: MailboxItem = {
        ...item,
        id: `mailbox_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        read: false,
      };
      setItems((prev) => [newItem, ...prev]);
    },
    []
  );

  const markAsRead = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, read: true } : item))
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
  }, []);

  const getUnreadCount = useCallback(() => {
    return items.filter((item) => !item.read).length;
  }, [items]);

  return (
    <MailboxContext.Provider
      value={{
        items,
        addItem,
        markAsRead,
        removeItem,
        clearAll,
        getUnreadCount,
      }}
    >
      {children}
    </MailboxContext.Provider>
  );
}

export function useMailbox() {
  const context = useContext(MailboxContext);
  if (!context) {
    throw new Error('useMailbox must be used within a MailboxProvider');
  }
  return context;
}
