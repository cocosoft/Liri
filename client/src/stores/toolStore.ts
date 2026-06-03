import { create } from "zustand";
import { Tool } from "../types";
import { toolService } from "../services/toolService";

interface ToolStore {
  tools: Tool[];
  isLoading: boolean;
  error: string | null;
  loadTools: () => Promise<void>;
  executeTool: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}

export const useToolStore = create<ToolStore>((set) => ({
  tools: [],
  isLoading: false,
  error: null,

  loadTools: async () => {
    set({ isLoading: true, error: null });
    try {
      const tools = await toolService.list();
      set({ tools, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  executeTool: async (toolName: string, args: Record<string, unknown>) => {
    set({ isLoading: true, error: null });
    try {
      const result = await toolService.execute(toolName, args);
      set({ isLoading: false });
      return result;
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },
}));
