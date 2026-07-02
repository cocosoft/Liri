import { create } from "zustand";
import { authService, type User, type ApiKey } from "../services/authService";
import { usageService } from "../services/usageService";
import { modelSwitchService } from "../services/modelSwitchService";
import { knowledgeService } from "../services/knowledgeService";
import { modelService } from "../services/modelService";
import { cronService } from "../services/cronService";
import { buddyService } from "../services/buddyService";
import { createLogger } from "@/utils/logger";
import { handleClientError } from "@/utils/handleError";
import {
  voiceService,
  connectVoiceWebSocket,
  disconnectVoiceWebSocket,
  onVoiceStateChange,
  onVoiceDisconnect,
  connectWakeWordWebSocket,
  disconnectWakeWordWebSocket,
  onWakeWordDetected,
  onWakeDisconnect,
  type VoiceSettings,
  type VoiceSession,
} from "../services/voiceService";

/** 字幕条目 */
export interface SubtitleEntry {
  text: string;
  timestamp: number;
  isFinal: boolean;
  confidence?: number;
}
import { chatService } from "../services/chatService";
import { useWorkspaceStore } from "./workspaceStore";
import type {
  UsageSummary,
  DailyUsageStats,
  ModelUsageStats,
  ProviderUsageStats,
  KnowledgeItem,
  ModelInfo,
  CronTask,
  ScheduleMode,
  BackendStatus,
  BuddyCompanion,
  BuddyInteractionResult,
} from "../types";
import type { CurrentModelInfo, TaskModelConfig } from "../types";

export type AppPage =
  | "home"
  | "chat"
  | "dashboard"
  | "logs"
  | "memory"
  | "skills"
  | "cron"
  | "files"
  | "knowledge"
  | "agent"
  | "channels"
  | "settings"
  | "buddy"
  | "plans"
  | "tts"
  | "semantic"
  | "workspace"
  | "tasks";

type NavigateFn = (path: string) => void;

// ============================================================
// Toast 系统类型
// ============================================================

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

// ============================================================
// Feature Flags 类型
// ============================================================

/** 所有 Feature Flag 定义 */
export interface FeatureFlags {
  /** 工具调用扁平化（旧版 ToolCallBlock / 新版 ToolCallInline） */
  toolcall_flat: boolean;
  /** 消息排队（一问一答 / 队列模式） */
  message_queue: boolean;
  /** 虚拟化（全量渲染 / 虚拟列表） */
  virtual_list: boolean;
  /** 拆分后的 ChatInput（原版 / 拆分版） */
  new_chat_input: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  toolcall_flat: true,
  message_queue: true,
  virtual_list: false,
  new_chat_input: false,
};

// ============================================================
// Council Store 类型（从 councilStore 迁入）
// ============================================================

/** 从后端流式事件中提取的发言 */
export interface CouncilStatementUI {
  id: string;
  agentId: string;
  agentName: string;
  round: number;
  type: "position" | "rebuttal" | "supplement" | "final";
  content: string;
  keyPoints: string[];
  timestamp: number;
}

/** Council 辩论阶段 */
export type CouncilPhaseUI = "idle" | "convening" | "debating" | "consensus" | "completed" | "error";

/** 共识结果 */
export type ConsensusResultUI = "unanimous" | "majority" | "deadlock";

// ============================================================
// Work Store 类型（从 workStore 迁入）
// ============================================================

/** 工作界面内容视图类型 */
export type ContentView = "welcome" | "project" | "plan_schema" | "plan_analysis" | "editor" | "diff" | "overview" | "team" | "cost" | "workflow_templates" | "council" | "intelligence" | "rules" | "agent";

/** 工作项生命周期状态 */
export type WorkItemStatus = "pending" | "running" | "paused" | "review" | "done" | "failed";

/** 工作项 */
export interface WorkItem {
  id: string;
  title: string;
  status: WorkItemStatus;
  description?: string;
  type?: string;
  workspaceId?: string;
  sessionId?: string;
  createdAt: number;
  updatedAt?: number;
  completedAt?: number;
  tags?: string[];
  priority?: number;
}

// ============================================================
// 合并后的 Store 接口
// ============================================================

export interface AppStore {
  // ---- 导航 ----
  activePage: AppPage;
  setActivePage: (page: AppPage) => void;
  _navigate: NavigateFn | null;
  _setNavigate: (fn: NavigateFn) => void;

  // ---- Toast ----
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;

  // ---- Feature Flags ----
  flags: FeatureFlags;
  setFlags: (partial: Partial<FeatureFlags>) => void;
  resetAll: () => void;

  // ---- Auth ----
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  authError: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, email?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearAuthError: () => void;

  // ---- ApiKey ----
  apiKeys: ApiKey[];
  apiKeyLoading: boolean;
  apiKeyError: string | null;
  loadApiKeys: () => Promise<void>;
  createApiKey: (name: string, permissions: string[], expiresInDays?: number) => Promise<string>;
  deleteApiKey: (id: string) => Promise<void>;

  // ---- Usage Stats ----
  usageSummary: UsageSummary | null;
  usageTrends: DailyUsageStats[];
  usageModelStats: ModelUsageStats[];
  usageProviderStats: ProviderUsageStats[];
  usageLoading: boolean;
  usageError: string | null;
  loadUsageAll: (rangeDays?: number) => Promise<void>;
  clearUsageError: () => void;

  // ---- Model Switch ----
	  currentModelId: string;      // UUID（内部标识符，用于比较匹配）
	  currentModelName: string;    // 模型名（用于 Footer 显示）
	  currentProvider: string;
  routerTier: string;
  routingMode: "dynamic" | "static" | "off";
  costThisSession: number;
  availableTasks: CurrentModelInfo["availableTasks"];
  tasks: TaskModelConfig;
  modelSwitchLoading: boolean;
  modelSwitchError: string | null;
  loadCurrentModel: () => Promise<void>;
  switchModel: (modelId: string) => Promise<void>;
  loadModelTasks: () => Promise<void>;
  saveModelTasks: (tasks: TaskModelConfig) => Promise<void>;

  // ---- Knowledge ----
  knowledgeItems: KnowledgeItem[];
  knowledgeLoading: boolean;
  knowledgeError: string | null;
  loadKnowledge: () => Promise<void>;
  createKnowledge: (item: Omit<KnowledgeItem, "id" | "created_at" | "updated_at">) => Promise<void>;
  updateKnowledge: (id: string, updates: Partial<KnowledgeItem>) => Promise<void>;
  deleteKnowledge: (id: string) => Promise<void>;

  // ---- Model Store ----
  models: ModelInfo[];
  modelLoading: boolean;
  modelError: string | null;
  loadModels: () => Promise<void>;
  toggleModel: (id: string) => Promise<boolean>;
  deleteModel: (id: string) => Promise<void>;
  clearModelError: () => void;

  // ---- Council ----
  councilIsActive: boolean;
  councilSessionId: string | null;
  councilPhase: CouncilPhaseUI;
  councilTopic: string;
  councilCurrentRound: number;
  councilStatements: CouncilStatementUI[];
  councilJoinedAgents: { agentId: string; agentName: string }[];
  councilResult: ConsensusResultUI | null;
  councilFinalProposal: string | null;
  councilMinorityOpinion: string | null;
  councilError: string | null;
  councilEventSource: EventSource | null;
  councilNotification: { active: boolean; sessionId: string | null; topic: string | null };
  startCouncil: (sessionId: string, topic: string) => void;
  addStatement: (statement: CouncilStatementUI) => void;
  addAgentJoined: (agentId: string, agentName: string) => void;
  setCouncilPhase: (phase: CouncilPhaseUI) => void;
  setCouncilRound: (round: number) => void;
  setCouncilResult: (result: ConsensusResultUI, finalProposal: string, minorityOpinion: string | null) => void;
  setCouncilError: (error: string) => void;
  setCouncilEventSource: (es: EventSource | null) => void;
  resetCouncil: () => void;

  // ---- Work ----
  workMode: "plan" | "do";
  activeWorkItem: WorkItem | null;
  contentView: ContentView;
  workTabs: string[] | undefined;
  setWorkMode: (mode: "plan" | "do") => void;
  toggleWorkMode: () => void;
  setActiveWorkItem: (item: WorkItem | null) => void;
  setContentView: (view: ContentView) => void;
  setWorkTabs: (tabs: string[] | undefined) => void;

  // ---- Cron ----
  cronTasks: CronTask[];
  cronLoading: boolean;
  cronError: string | null;
  cronSaving: boolean;
  cronSchedulerStatus: { running: boolean; lastTickAt?: number; activeJobs: number; totalJobs: number; uptimeMs: number } | null;
  cronStatusLoading: boolean;
  loadCronTasks: () => Promise<void>;
  loadCronStatus: () => Promise<void>;
  createCronTask: (task: {
    name: string;
    expression: string;
    prompt?: string;
    description?: string;
    enabled?: boolean;
    scheduleMode?: ScheduleMode;
    silent?: boolean;
    everyValue?: number;
    everyUnit?: string;
    atHour?: string;
    atMinute?: string;
    deliver?: string;
    deliverTo?: string;
  }) => Promise<void>;
  updateCronTask: (id: string, updates: Partial<CronTask>) => Promise<void>;
  deleteCronTask: (id: string) => Promise<void>;
  toggleCronTask: (id: string, enabled: boolean) => Promise<void>;
  runCronTaskNow: (id: string) => Promise<void>;

  // ---- Backend ----
  backendStatus: BackendStatus;
  backendIsChecking: boolean;
  backendError: string | null;
  backendIsBrowserMode: boolean;
  checkBackendStatus: () => Promise<void>;
  startBackend: () => Promise<void>;
  stopBackend: () => Promise<void>;
  clearBackendError: () => void;
  initBrowserMode: () => Promise<void>;

  // ---- Buddy ----
  buddyCompanion: BuddyCompanion | null;
  buddyLastInteraction: BuddyInteractionResult | null;
  buddyStats: { interactions: number; dreamsCompleted: number; totalXp: number } | null;
  buddyLoading: boolean;
  buddyError: string | null;
  loadBuddy: (name?: string) => Promise<void>;
  buddyInteract: (action: string, name?: string) => Promise<void>;
  loadBuddyStats: () => Promise<void>;

  // ---- Voice ----
  voiceSettings: VoiceSettings | null;
  voiceSessions: VoiceSession[];
  voiceCurrentSession: VoiceSession | null;
  voiceSessionState: string;
  voiceWsConnected: boolean;
  voiceIsRecording: boolean;
  voiceIsProcessing: boolean;
  voiceIsPlaying: boolean;
  voiceError: string | null;
  audioLevel: number;
  micStatus: { status: string; audioLevel: number } | null;
  loadVoiceSettings: () => Promise<void>;
  updateVoiceSettings: (settings: Partial<VoiceSettings>) => Promise<void>;
  connectVoiceWebSocket: () => Promise<void>;
  disconnectVoiceWebSocket: () => void;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  playResponse: (audioUrl: string) => Promise<void>;
  stopPlayback: () => void;
  clearVoiceError: () => void;

  // ---- Subtitle ----
  interimText: string;
  finalText: string;
  subtitleHistory: SubtitleEntry[];
  subtitleStatus: "idle" | "listening" | "processing" | "done";

  // ---- Wake Word ----
  wakeWordEnabled: boolean;
  wakeWordTriggers: string[];
  wakeWordListening: boolean;
  wakeWordTriggered: string | null;
  wakeWsConnected: boolean;
  toggleWakeWord: () => Promise<void>;
  setWakeWordTriggers: (triggers: string[]) => Promise<void>;
  connectWakeWordWebSocket: () => Promise<void>;
  disconnectWakeWordWebSocket: () => void;

  // ---- TTS ----
  ttsProviders: string[];
  ttsVoices: { id: string; name: string; language: string }[];
  ttsHealth: { status: string; message?: string };
  loadTTSProviders: () => Promise<void>;
  loadTTSVoices: (provider: string) => Promise<void>;
  checkTTSHealth: () => Promise<void>;
}

// ============================================================
// Store 创建
// ============================================================

const logger = createLogger("appStore");

export const useAppStore = create<AppStore>((set, get) => ({
  // ---- 导航 ----
  activePage: "home",
  _navigate: null,

  setActivePage: (page) => {
    set({ activePage: page });
    const nav = get()._navigate;
    if (nav) {
      nav(page === "home" ? "/" : `/${page}`);
    }
  },

  _setNavigate: (fn) => set({ _navigate: fn }),

  // ---- Toast ----
  toasts: [],

  addToast: (type: ToastType, message: string, duration: number = 3000) => {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { id, type, message, duration }] });

    if (duration > 0) {
      setTimeout(() => {
        // 使用函数式 set 确保获取最新的 toasts 状态
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
  },

  removeToast: (id: string) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  // ---- Feature Flags ----
  flags: { ...DEFAULT_FLAGS },

  setFlags: (partial: Partial<FeatureFlags>) => {
    set((state) => ({ flags: { ...state.flags, ...partial } }));
  },

  resetAll: () => {
    set({ flags: { ...DEFAULT_FLAGS } });
  },

  // ---- Auth ----
  user: authService.getStoredUser(),
  token: authService.getStoredToken(),
  isAuthenticated: authService.isAuthenticated(),
  authLoading: false,
  authError: null,

  login: async (username: string, password: string) => {
    set({ authLoading: true, authError: null });
    try {
      const response = await authService.login({ username, password });
      set({
        user: response.user,
        token: response.token,
        isAuthenticated: true,
        authLoading: false,
      });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'login' }, 'warn');
      set({
        authError: e instanceof Error ? e.message : "登录失败",
        authLoading: false,
      });
      throw e;
    }
  },

  register: async (username: string, password: string, email?: string) => {
    set({ authLoading: true, authError: null });
    try {
      const response = await authService.register({ username, password, email });
      set({
        user: response.user,
        token: response.token,
        isAuthenticated: true,
        authLoading: false,
      });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'register' }, 'warn');
      set({
        authError: e instanceof Error ? e.message : "注册失败",
        authLoading: false,
      });
      throw e;
    }
  },

  logout: async () => {
    set({ authLoading: true });
    try {
      await authService.logout();
    } finally {
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        authLoading: false,
      });
    }
  },

  checkAuth: async () => {
    if (!authService.isAuthenticated()) {
      set({ isAuthenticated: false, user: null });
      return;
    }
    set({ authLoading: true });
    try {
      const user = await authService.getCurrentUser();
      set({
        user,
        isAuthenticated: !!user,
        authLoading: false,
      });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'checkAuth' }, 'warn');
      set({
        user: null,
        isAuthenticated: false,
        authLoading: false,
      });
    }
  },

  clearAuthError: () => set({ authError: null }),

  // ---- ApiKey ----
  apiKeys: [],
  apiKeyLoading: false,
  apiKeyError: null,

  loadApiKeys: async () => {
    set({ apiKeyLoading: true, apiKeyError: null });
    try {
      const apiKeys = await authService.listApiKeys();
      set({ apiKeys, apiKeyLoading: false });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'loadApiKeys' }, 'warn');
      set({
        apiKeyError: e instanceof Error ? e.message : "获取API密钥列表失败",
        apiKeyLoading: false,
      });
    }
  },

  createApiKey: async (name: string, permissions: string[], expiresInDays?: number) => {
    set({ apiKeyLoading: true, apiKeyError: null });
    try {
      const result = await authService.createApiKey(name, permissions, expiresInDays);
      set((state) => ({
        apiKeys: [...state.apiKeys, { ...result, key: undefined } as ApiKey],
        apiKeyLoading: false,
      }));
      return result.key;
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'createApiKey' }, 'warn');
      set({
        apiKeyError: e instanceof Error ? e.message : "创建API密钥失败",
        apiKeyLoading: false,
      });
      throw e;
    }
  },

  deleteApiKey: async (id: string) => {
    set({ apiKeyLoading: true, apiKeyError: null });
    try {
      await authService.deleteApiKey(id);
      set((state) => ({
        apiKeys: state.apiKeys.filter((k) => k.id !== id),
        apiKeyLoading: false,
      }));
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'deleteApiKey' }, 'warn');
      set({
        apiKeyError: e instanceof Error ? e.message : "删除API密钥失败",
        apiKeyLoading: false,
      });
      throw e;
    }
  },

  // ---- Usage Stats ----
  usageSummary: null,
  usageTrends: [],
  usageModelStats: [],
  usageProviderStats: [],
  usageLoading: false,
  usageError: null,

  loadUsageAll: async (rangeDays = 30) => {
    set({ usageLoading: true, usageError: null });
    try {
      const end = Math.floor(Date.now() / 1000);
      const start = end - rangeDays * 86400;
      const range = { startDate: start, endDate: end };
      const todayEnd = Math.floor(Date.now() / 1000);
      const todayStart = todayEnd - 86400;
      const todayRange = { startDate: todayStart, endDate: todayEnd };

      const [summary, trends, modelStats, providerStats] = await Promise.all([
        usageService.summary(todayRange),
        usageService.trend(range),
        usageService.modelStats(range),
        usageService.providerStats(range),
      ]);
      set({ usageSummary: summary, usageTrends: trends, usageModelStats: modelStats, usageProviderStats: providerStats, usageLoading: false });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'loadUsageAll' }, 'warn');
      set({
        usageError: e instanceof Error ? e.message : "获取使用量统计失败",
        usageLoading: false,
      });
    }
  },

  clearUsageError: () => set({ usageError: null }),

  // ---- Model Switch ----
  currentModelId: "",
  currentModelName: "",
  currentProvider: "deepseek",
  routerTier: "",
  routingMode: "static" as const,
  costThisSession: 0,
  availableTasks: [],
  tasks: {},
  modelSwitchLoading: false,
  modelSwitchError: null,

  loadCurrentModel: async () => {
	    set({ modelSwitchLoading: true, modelSwitchError: null });
	    try {
	      const info = await modelSwitchService.getCurrent();
	      set({
	        currentModelId: info.modelUuid,       // UUID（用于比较匹配）
	        currentModelName: info.modelId,       // 模型名（用于显示）
	        currentProvider: info.provider,
        routerTier: info.routerTier ?? "",
        routingMode: info.routingMode ?? "static",
        costThisSession: info.costThisSession,
        availableTasks: info.availableTasks,
        modelSwitchLoading: false,
      });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'loadCurrentModel' }, 'warn');
      set({
        modelSwitchError: e instanceof Error ? e.message : "获取当前模型失败",
        modelSwitchLoading: false,
      });
    }
  },

  switchModel: async (modelId) => {
	    set({ modelSwitchError: null });
	    try {
	      await modelSwitchService.switch(modelId);
	      // 切换后重新获取任务分工配置（确保 tasks.default 同步）
	      const tasks = await modelSwitchService.getTasks();
	      // 从已加载的 models 列表中查找模型名（用于 Footer 显示）
	      const model = get().models.find((m) => m.id === modelId);
	      set({ currentModelId: modelId, currentModelName: model?.modelId || model?.name || modelId, tasks });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'switchModel' }, 'warn');
      set({ modelSwitchError: e instanceof Error ? e.message : "切换模型失败" });
    }
  },

  loadModelTasks: async () => {
    try {
      const tasks = await modelSwitchService.getTasks();
      set({ tasks });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'loadModelTasks' }, 'warn');
      set({ modelSwitchError: e instanceof Error ? e.message : "获取任务策略失败" });
    }
  },

  saveModelTasks: async (tasks) => {
    set({ modelSwitchError: null });
    try {
      await modelSwitchService.saveTasks(tasks);
      set({ tasks });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'saveModelTasks' }, 'warn');
      set({ modelSwitchError: e instanceof Error ? e.message : "保存任务策略失败" });
    }
  },

  // ---- Knowledge ----
  knowledgeItems: [],
  knowledgeLoading: false,
  knowledgeError: null,

  loadKnowledge: async () => {
    set({ knowledgeLoading: true, knowledgeError: null });
    try {
      const items = await knowledgeService.list();
      set({ knowledgeItems: items, knowledgeLoading: false });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'loadKnowledge' }, 'warn');
      set({ knowledgeError: String(e), knowledgeLoading: false });
    }
  },

  createKnowledge: async (item) => {
    try {
      const created = await knowledgeService.create(item);
      set((state) => ({ knowledgeItems: [...state.knowledgeItems, created] }));
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'createKnowledge' }, 'warn');
      set({ knowledgeError: String(e) });
    }
  },

  updateKnowledge: async (id, updates) => {
    try {
      const updated = await knowledgeService.update(id, updates);
      set((state) => ({
        knowledgeItems: state.knowledgeItems.map((i) => (i.id === id ? updated : i)),
      }));
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'updateKnowledge' }, 'warn');
      set({ knowledgeError: String(e) });
    }
  },

  deleteKnowledge: async (id) => {
    try {
      await knowledgeService.delete(id);
      set((state) => ({ knowledgeItems: state.knowledgeItems.filter((i) => i.id !== id) }));
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'deleteKnowledge' }, 'warn');
      set({ knowledgeError: String(e) });
    }
  },

  // ---- Model Store ----
  models: [],
  modelLoading: false,
  modelError: null,

  loadModels: async () => {
    set({ modelLoading: true, modelError: null });
    try {
      const models = await modelService.list();
      set({ models, modelLoading: false });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'loadModels' }, 'warn');
      set({ modelError: e instanceof Error ? e.message : "获取模型列表失败", modelLoading: false });
    }
  },

  toggleModel: async (id: string) => {
    try {
      const enabled = await modelService.toggle(id);
      set((state) => ({
        models: state.models.map((m) => (m.id === id ? { ...m, enabled } : m)),
      }));
      return enabled;
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'toggleModel' }, 'warn');
      set({ modelError: e instanceof Error ? e.message : "切换模型状态失败" });
      throw e;
    }
  },

  deleteModel: async (id: string) => {
    try {
      await modelService.remove(id);
      set((state) => ({ models: state.models.filter((m) => m.id !== id) }));
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'deleteModel' }, 'warn');
      set({ modelError: e instanceof Error ? e.message : "删除模型失败" });
      throw e;
    }
  },

  clearModelError: () => set({ modelError: null }),

  // ---- Council ----
  councilIsActive: false,
  councilSessionId: null,
  councilPhase: "idle",
  councilTopic: "",
  councilCurrentRound: 0,
  councilStatements: [],
  councilJoinedAgents: [],
  councilResult: null,
  councilFinalProposal: null,
  councilMinorityOpinion: null,
  councilError: null,
  councilEventSource: null,
  councilNotification: { active: false, sessionId: null, topic: null },

  startCouncil: (sessionId, topic) => {
    // 先清理旧连接
    const prev = get().councilEventSource;
    if (prev) {
      prev.close();
    }

    set({
      councilIsActive: true,
      councilSessionId: sessionId,
      councilTopic: topic,
      councilPhase: "convening",
      councilCurrentRound: 0,
      councilStatements: [],
      councilJoinedAgents: [],
      councilResult: null,
      councilFinalProposal: null,
      councilMinorityOpinion: null,
      councilError: null,
      councilNotification: { active: true, sessionId, topic },
    });

    // 使用 workspaceStore 获取当前 workspace ID
    const workspaceId = useWorkspaceStore.getState().currentWorkspace?.id || 'default';
    const API_BASE = ''; // 相对路径，使用同源 SSE

    const es = new EventSource(
      `${API_BASE}/v1/workspaces/${workspaceId}/council/${sessionId}/stream`
    );

    es.addEventListener("council_started", () => {
      set({ councilPhase: "convening" });
    });

    es.addEventListener("agent_joined", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      set((state) => ({
        councilJoinedAgents: [
          ...(state.councilJoinedAgents || []),
          { agentId: data.agentId, agentName: data.agentName },
        ],
      }));
    });

    es.addEventListener("statement", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      get().addStatement(data.statement);
    });

    es.addEventListener("round_started", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      set({ councilPhase: "debating", councilCurrentRound: data.round });
    });

    es.addEventListener("consensus_reached", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      set({
        councilPhase: "consensus",
        councilResult: data.result,
        councilFinalProposal: data.finalProposal,
        councilMinorityOpinion: data.minorityOpinion,
      });
    });

    es.addEventListener("council_completed", () => {
      set({
        councilPhase: "completed",
        councilNotification: { active: false, sessionId: null, topic: null },
      });

      // 弹 toast 通知（如果用户不在理事会 Tab）
      const { contentView, addToast } = get();
      if (contentView !== "council") {
        addToast("info", `🏛️ 理事会已达成共识："${get().councilTopic}"`, 5000);
      }

      es.close();
      set({ councilEventSource: null });
    });

    es.addEventListener("council_error", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      set({
        councilPhase: "error",
        councilError: data.error,
        councilNotification: { active: false, sessionId: null, topic: null },
      });
      es.close();
      set({ councilEventSource: null });
    });

    es.addEventListener("error", (e) => {
      handleClientError(e instanceof ErrorEvent ? e : new Error('SSE 连接异常'), { module: 'stores:appStore', action: 'councilSSE' }, 'warn');
    });

    set({ councilEventSource: es });
  },

  addStatement: (statement) =>
    set((state) => ({ councilStatements: [...state.councilStatements, statement] })),

  addAgentJoined: (agentId, agentName) =>
    set((state) => ({
      councilJoinedAgents: [
        ...(state.councilJoinedAgents || []),
        { agentId, agentName },
      ],
    })),

  setCouncilPhase: (phase) => set({ councilPhase: phase }),

  setCouncilRound: (round) => set({ councilCurrentRound: round }),

  setCouncilResult: (result, finalProposal, minorityOpinion) =>
    set({ councilResult: result, councilFinalProposal: finalProposal, councilMinorityOpinion: minorityOpinion }),

  setCouncilError: (error) => set({ councilError: error, councilIsActive: false }),

  setCouncilEventSource: (es) => set({ councilEventSource: es }),

  resetCouncil: () => {
    const { councilEventSource } = get();
    if (councilEventSource) {
      councilEventSource.close();
    }
    set({
      councilIsActive: false,
      councilSessionId: null,
      councilPhase: "idle",
      councilTopic: "",
      councilCurrentRound: 0,
      councilStatements: [],
      councilJoinedAgents: [],
      councilResult: null,
      councilFinalProposal: null,
      councilMinorityOpinion: null,
      councilError: null,
      councilEventSource: null,
      councilNotification: { active: false, sessionId: null, topic: null },
    });
  },

  // ---- Work ----
  workMode: "plan",
  activeWorkItem: null,
  contentView: "welcome",
  workTabs: undefined,

  setWorkMode: (mode) => {
    set({ workMode: mode });
    if (mode === "plan") {
      set({ contentView: "plan_schema" });
    } else {
      set({ contentView: "editor" });
    }
  },

  toggleWorkMode: () => {
    const current = get().workMode;
    get().setWorkMode(current === "plan" ? "do" : "plan");
  },

  setActiveWorkItem: (item) => set({ activeWorkItem: item }),

  setContentView: (view) => set({ contentView: view }),

  setWorkTabs: (tabs) => set({ workTabs: tabs }),

  // ---- Cron ----
  cronTasks: [],
  cronLoading: false,
  cronError: null,
  cronSaving: false,
  cronSchedulerStatus: null,
  cronStatusLoading: false,

  loadCronTasks: async () => {
    set({ cronLoading: true, cronError: null });
    try {
      const tasks = await cronService.list();
      set({ cronTasks: tasks, cronLoading: false });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'loadCronTasks' }, 'warn');
      set({ cronError: String(e), cronLoading: false });
    }
  },

  loadCronStatus: async () => {
    set({ cronStatusLoading: true });
    try {
      const status = await cronService.getStatus();
      set({ cronSchedulerStatus: status, cronStatusLoading: false });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'loadCronStatus' }, 'warn');
      set({ cronSchedulerStatus: null, cronStatusLoading: false });
    }
  },

  createCronTask: async (task) => {
    set({ cronSaving: true });
    try {
      const created = await cronService.create(task as any);
      set((state) => ({ cronTasks: [...state.cronTasks, created] }));
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'createCronTask' }, 'warn');
      set({ cronError: String(e) });
    } finally {
      set({ cronSaving: false });
    }
  },

  updateCronTask: async (id, updates) => {
    set({ cronSaving: true });
    try {
      const updated = await cronService.update(id, updates);
      set((state) => ({
        cronTasks: state.cronTasks.map((t) => (t.id === id ? updated : t)),
      }));
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'updateCronTask' }, 'warn');
      set({ cronError: String(e) });
    } finally {
      set({ cronSaving: false });
    }
  },

  deleteCronTask: async (id) => {
    set({ cronSaving: true });
    try {
      await cronService.delete(id);
      set((state) => ({ cronTasks: state.cronTasks.filter((t) => t.id !== id) }));
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'deleteCronTask' }, 'warn');
      set({ cronError: String(e) });
    } finally {
      set({ cronSaving: false });
    }
  },

  toggleCronTask: async (id, enabled) => {
    set({ cronSaving: true });
    try {
      const updated = await cronService.toggle(id, enabled);
      set((state) => ({
        cronTasks: state.cronTasks.map((t) => (t.id === id ? updated : t)),
      }));
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'toggleCronTask' }, 'warn');
      set({ cronError: String(e) });
    } finally {
      set({ cronSaving: false });
    }
  },

  runCronTaskNow: async (id) => {
    set({ cronSaving: true });
    try {
      await cronService.runNow(id);
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'runCronTaskNow' }, 'warn');
      set({ cronError: String(e) });
    } finally {
      set({ cronSaving: false });
    }
  },

  // ---- Backend ----
  backendStatus: { running: false, port: null },
  backendIsChecking: false,
  backendError: null,
  backendIsBrowserMode: true,

  initBrowserMode: async () => {
    const tauri = await (async () => {
      if (typeof window === "undefined") return false;
      if ("__TAURI__" in window || "__TAURI_INTERNALS__" in window) return true;
      try { await import("@tauri-apps/api/core"); return true; }
      catch { return false; }
    })();
    set({ backendIsBrowserMode: !tauri });
  },

  checkBackendStatus: async () => {
    set({ backendIsChecking: true });
    try {
      const status = await chatService.getBackendStatus();
      set({ backendStatus: status, backendIsChecking: false, backendError: null });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'checkBackendStatus' }, 'warn');
      set({ backendStatus: { running: false, port: null }, backendIsChecking: false, backendError: e instanceof Error ? e.message : String(e) });
    }
  },

  startBackend: async () => {
    set({ backendError: null });
    if (!get().backendIsBrowserMode) {
      try {
        const status = await chatService.startBackend();
        set({ backendStatus: status });
      } catch (e) {
        handleClientError(e, { module: 'stores:appStore', action: 'startBackend' }, 'warn');
        set({ backendError: e instanceof Error ? e.message : String(e) });
      }
    } else {
      set({ backendError: "浏览器模式下无法自动启动后端。请在终端中运行：\ncd app && bun run src/main.ts repl --http-port 7890\n启动后刷新页面。" });
    }
  },

  stopBackend: async () => {
    set({ backendError: null });
    if (!get().backendIsBrowserMode) {
      try {
        await chatService.stopBackend();
        set({ backendStatus: { running: false, port: null } });
      } catch (e) {
        handleClientError(e, { module: 'stores:appStore', action: 'stopBackend' }, 'warn');
        set({ backendError: e instanceof Error ? e.message : String(e) });
      }
    } else {
      set({ backendStatus: { running: false, port: null } });
    }
  },

  clearBackendError: () => set({ backendError: null }),

  // ---- Buddy ----
  buddyCompanion: null,
  buddyLastInteraction: null,
  buddyStats: null,
  buddyLoading: false,
  buddyError: null,

  loadBuddy: async (name) => {
    set({ buddyLoading: true, buddyError: null });
    try {
      const companion = await buddyService.getBuddy(name);
      set({ buddyCompanion: companion, buddyLoading: false });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'loadBuddy' }, 'warn');
      set({ buddyError: String(e), buddyLoading: false });
    }
  },

  buddyInteract: async (action, name) => {
    set({ buddyError: null });
    try {
      const result = await buddyService.interact(action, name);
      set({ buddyCompanion: result.companion, buddyLastInteraction: result });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'buddyInteract' }, 'warn');
      set({ buddyError: String(e) });
    }
  },

  loadBuddyStats: async () => {
    try {
      const stats = await buddyService.getStats();
      set({ buddyStats: stats });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'loadBuddyStats' }, 'warn');
      set({ buddyError: String(e) });
    }
  },

  // ---- Voice ----
  voiceSettings: null,
  voiceSessions: [],
  voiceCurrentSession: null,
  voiceSessionState: "idle",
  voiceWsConnected: false,
  voiceIsRecording: false,
  voiceIsProcessing: false,
  voiceIsPlaying: false,
  voiceError: null,
  audioLevel: 0,
  micStatus: null,

  // ---- Subtitle ----
  interimText: "",
  finalText: "",
  subtitleHistory: [],
  subtitleStatus: "idle",

  // ---- Wake Word ----
  wakeWordEnabled: false,
  wakeWordTriggers: [],
  wakeWordListening: false,
  wakeWordTriggered: null,
  wakeWsConnected: false,

  // ---- TTS ----
  ttsProviders: [],
  ttsVoices: [],
  ttsHealth: { status: "unknown" },

  loadVoiceSettings: async () => {
    try {
      const settings = await voiceService.getSettings();
      set({ voiceSettings: settings, voiceError: null });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'loadVoiceSettings' }, 'warn');
      set({ voiceError: e instanceof Error ? e.message : "加载语音设置失败" });
    }
  },

  updateVoiceSettings: async (updates) => {
    const { voiceSettings } = get();
    if (!voiceSettings) return;
    set({ voiceIsProcessing: true, voiceError: null });
    try {
      const updated = await voiceService.updateSettings({ ...voiceSettings, ...updates });
      set({ voiceSettings: updated });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'updateVoiceSettings' }, 'warn');
      set({ voiceError: e instanceof Error ? e.message : "更新语音设置失败" });
    } finally {
      set({ voiceIsProcessing: false });
    }
  },

  connectVoiceWebSocket: async () => {
    // 注册状态变更回调
    onVoiceStateChange((state, _previous) => {
      set({ voiceSessionState: state });

      // 状态变为 disconnected/error 时自动清理录音状态
      if (state === "disconnected" || state === "error") {
        set({
          voiceIsRecording: false,
          voiceIsProcessing: false,
          voiceCurrentSession: null,
        });
      }
    });

    // 注册断开回调 — 心跳超时或 WS 断开时自动重置
    onVoiceDisconnect(() => {
      set({
        voiceWsConnected: false,
        voiceSessionState: "idle",
        voiceIsRecording: false,
        voiceIsProcessing: false,
        voiceCurrentSession: null,
      });
    });

    try {
      await connectVoiceWebSocket();
      set({ voiceWsConnected: true, voiceSessionState: "connected" });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'connectVoiceWebSocket' }, 'warn');
      set({ voiceWsConnected: false });
    }
  },

  disconnectVoiceWebSocket: () => {
    disconnectVoiceWebSocket();
    set({ voiceWsConnected: false, voiceSessionState: "idle" });
  },

  startRecording: async () => {
    set({ voiceIsRecording: true, voiceError: null, audioLevel: 0 });
    try {
      // P2-2: 先建立 WebSocket 连接（自动连接 /voice 端点）
      if (!get().voiceWsConnected) {
        await get().connectVoiceWebSocket();
      }

      const session = await voiceService.startSession();
      set({ voiceCurrentSession: session, voiceSessionState: "active" });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'startRecording' }, 'warn');
      set({ voiceError: e instanceof Error ? e.message : "开始录音失败", voiceIsRecording: false });
    }
  },

  stopRecording: async () => {
    const { voiceCurrentSession } = get();
    if (!voiceCurrentSession) { set({ voiceIsRecording: false }); return; }
    set({ voiceIsRecording: false, voiceIsProcessing: true });
    try {
      await voiceService.endSession(voiceCurrentSession.id);
      set({ voiceCurrentSession: null });

      // P2-2: 断开 WebSocket 连接
      get().disconnectVoiceWebSocket();
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'stopRecording' }, 'warn');
      set({ voiceError: e instanceof Error ? e.message : "停止录音失败" });
    } finally {
      set({ voiceIsProcessing: false });

      // P2-4-6: 唤醒词录音结束后，复位监听状态以继续循环
      const { wakeWordEnabled } = get();
      if (wakeWordEnabled) {
        set({ wakeWordListening: true, wakeWordTriggered: null });
      }
    }
  },

  playResponse: async (audioUrl) => {
    try {
      set({ voiceIsPlaying: true });
      const audio = new Audio(audioUrl);
      audio.onended = () => set({ voiceIsPlaying: false });
      audio.onerror = () => { set({ voiceIsPlaying: false, voiceError: "音频播放失败" }); };
      await audio.play();
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'playResponse' }, 'warn');
      set({ voiceIsPlaying: false, voiceError: "音频播放失败" });
    }
  },

  stopPlayback: () => { set({ voiceIsPlaying: false }); },

  clearVoiceError: () => set({ voiceError: null }),

  // ---- Wake Word Actions ----
  toggleWakeWord: async () => {
    const { wakeWordEnabled } = get();
    const newEnabled = !wakeWordEnabled;
    set({ wakeWordEnabled: newEnabled });

    if (newEnabled) {
      try {
        const res = await fetch('/v1/voice/wake/start', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          set({ wakeWordListening: data.status === 'listening' });

          // 连接唤醒词 WS，监听 wakeword_detected 事件
          await get().connectWakeWordWebSocket();
        }
      } catch (e) {
        handleClientError(e, { module: 'stores:appStore', action: 'toggleWakeWord:start' }, 'warn');
        set({ wakeWordEnabled: false, wakeWordListening: false });
      }
    } else {
      try {
        await fetch('/v1/voice/wake/stop', { method: 'POST' });
      } catch (e) {
        handleClientError(e, { module: 'stores:appStore', action: 'toggleWakeWord:stop' }, 'warn');
      }
      get().disconnectWakeWordWebSocket();
      set({ wakeWordListening: false, wakeWordTriggered: null });
    }
  },

  setWakeWordTriggers: async (triggers) => {
    set({ wakeWordTriggers: triggers });
    try {
      await fetch('/v1/voice/wake/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggers }),
      });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'setWakeWordTriggers' }, 'warn');
    }
  },

  connectWakeWordWebSocket: async () => {
    // 注册唤醒词检测回调
    onWakeWordDetected((data) => {
      const store = get();

      // 更新触发状态
      set({
        wakeWordTriggered: data.matchedTrigger,
        wakeWordListening: false,
      });

      // 如果当前不在录音中，自动开始录音
      if (!store.voiceIsRecording && !store.voiceIsProcessing) {
        store.startRecording().catch((e) => {
          handleClientError(e, { module: 'stores:appStore', action: 'wakeWordAutoRecord' }, 'warn');
        });
      }
    });

    // 注册断开回调
    onWakeDisconnect(() => {
      set({ wakeWsConnected: false });
    });

    try {
      await connectWakeWordWebSocket();
      set({ wakeWsConnected: true });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'connectWakeWordWebSocket' }, 'warn');
      set({ wakeWsConnected: false });
    }
  },

  disconnectWakeWordWebSocket: () => {
    disconnectWakeWordWebSocket(true);
    set({ wakeWsConnected: false });
  },

  // ---- TTS Actions ----
  loadTTSProviders: async () => {
    try {
      const providers = await voiceService.getTTSProviders();
      set({ ttsProviders: providers });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'loadTTSProviders' }, 'warn');
    }
  },

  loadTTSVoices: async (provider) => {
    try {
      const voices = await voiceService.getVoices(provider);
      set({ ttsVoices: voices });
    } catch (e) {
      handleClientError(e, { module: 'stores:appStore', action: 'loadTTSVoices' }, 'warn');
    }
  },

  checkTTSHealth: async () => {
    const health = await voiceService.checkTTSHealth();
    set({ ttsHealth: health });
  },
}));

// ============================================================
// 状态变更日志（仅开发环境）
// 用于调试 Store 状态变化，追踪异常更新源
// ============================================================

if (import.meta.env.DEV) {
  const IGNORED_KEYS = new Set<keyof AppStore>([
    "_navigate", "_setNavigate", "toasts",
  ]);

  useAppStore.subscribe((state, prev) => {
    const changed: string[] = [];

    for (const key of Object.keys(state) as (keyof AppStore)[]) {
      if (IGNORED_KEYS.has(key)) continue;
      if (state[key] !== prev[key]) {
        changed.push(key);
      }
    }

    if (changed.length > 0) {
      logger.info(`changed: ${changed.join(", ")}`);
    }
  });
}
