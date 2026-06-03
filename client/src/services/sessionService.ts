import type { Message, Session } from "../types";
import { http } from "./httpClient";

const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

async function getTauriCore() {
  if (!isTauri) return null;
  try {
    return await import("@tauri-apps/api/core");
  } catch {
    return null;
  }
}

function createMemorySessionService() {
  return {
    list: async (): Promise<Session[]> => [],
    create: async (title: string): Promise<Session> => ({
      id: `local-${Date.now()}`,
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    }),
    switch: async (_id: string): Promise<Session> => ({
      id: _id,
      title: "恢复的会话",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    }),
    delete: async (_id: string): Promise<void> => {},
    rename: async (_id: string, _title: string): Promise<void> => {},
    getCurrent: async (): Promise<Session | null> => null,
  };
}

async function tryTauri<T>(
  method: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const core = await getTauriCore();
  if (!core) return null;
  try {
    return await core.invoke<T>(method, args);
  } catch {
    return null;
  }
}

export const sessionService = {
  list: async (): Promise<Session[]> => {
    try {
      return await http.get<Session[]>("/v1/sessions");
    } catch {
      const result = await tryTauri<Session[]>("list_sessions");
      if (result) return result;
      return createMemorySessionService().list();
    }
  },

  create: async (title: string): Promise<Session> => {
    try {
      return await http.post<Session>("/v1/sessions", { title });
    } catch {
      const result = await tryTauri<Session>("create_session", { title });
      if (result) return result;
      return createMemorySessionService().create(title);
    }
  },

  switch: async (id: string): Promise<Session> => {
    try {
      return await http.post<Session>(`/v1/sessions/${id}/switch`);
    } catch {
      const result = await tryTauri<Session>("switch_session", { id });
      if (result) return result;
      return createMemorySessionService().switch(id);
    }
  },

  delete: async (id: string): Promise<void> => {
    try {
      await http.delete<void>(`/v1/sessions/${id}`);
    } catch {
      const result = await tryTauri<void>("delete_session", { id });
      if (result !== null) return;
      return createMemorySessionService().delete(id);
    }
  },

  rename: async (id: string, title: string): Promise<void> => {
    try {
      await http.put<void>(`/v1/sessions/${id}`, { title });
    } catch {
      const result = await tryTauri<void>("rename_session", { id, title });
      if (result !== null) return;
      return createMemorySessionService().rename(id, title);
    }
  },

  generateTitle: async (
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
  ): Promise<string | null> => {
    try {
      const response = await http.post<{
        success: boolean;
        title: string | null;
      }>(`/v1/sessions/${sessionId}/title`, { userMessage, assistantResponse });
      return response.title;
    } catch {
      const result = await tryTauri<{ title: string | null }>(
        "generate_session_title",
        {
          sessionId,
          userMessage,
          assistantResponse,
        },
      );
      return result?.title || null;
    }
  },

  getCurrent: async (): Promise<Session | null> => {
    try {
      return await http.get<Session | null>("/v1/sessions/current");
    } catch {
      const result = await tryTauri<Session | null>("get_current_session");
      if (result !== null) return result;
      return createMemorySessionService().getCurrent();
    }
  },

  get: async (id: string): Promise<Session | null> => {
    try {
      return await http.get<Session>(`/v1/sessions/${id}`);
    } catch {
      const result = await tryTauri<Session | null>("get_session", { id });
      if (result !== null) return result;
      return createMemorySessionService()
        .list()
        .then((sessions) => sessions.find((s) => s.id === id) || null);
    }
  },

  getMessages: async (sessionId: string): Promise<Message[]> => {
    try {
      return await http.get<Message[]>(`/v1/sessions/${sessionId}/messages`);
    } catch {
      const result = await tryTauri<Message[]>("get_session_messages", {
        sessionId,
      });
      if (result) return result;
      return [];
    }
  },

  clearAll: async (): Promise<void> => {
    try {
      await http.delete<void>("/v1/sessions");
    } catch {
      const result = await tryTauri<void>("clear_all_sessions");
      if (result !== null) return;
    }
  },
};
