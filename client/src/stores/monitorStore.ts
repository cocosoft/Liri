import { create } from 'zustand';
import { monitorService, type MetricsData, type MonitorSummary } from '../services/monitorService';
import type { Alert, SystemHealth } from '../types';

interface MonitorStore {
  metrics: MetricsData | null;
  summary: MonitorSummary | null;
  alerts: Alert[];
  systemHealth: SystemHealth | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;

  fetchMetrics: (timeRange?: number) => Promise<void>;
  fetchSummary: () => Promise<void>;
  fetchAlerts: (acknowledged?: boolean) => Promise<void>;
  fetchSystemHealth: () => Promise<void>;
  acknowledgeAlert: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useMonitorStore = create<MonitorStore>((set) => ({
  metrics: null,
  summary: null,
  alerts: [],
  systemHealth: null,
  isLoading: false,
  error: null,
  lastUpdated: null,

  fetchMetrics: async (timeRange = 3600000) => {
    set({ isLoading: true, error: null });
    try {
      const metrics = await monitorService.getMetrics(timeRange);
      set({ metrics, isLoading: false, lastUpdated: Date.now() });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : '获取指标数据失败',
        isLoading: false,
      });
    }
  },

  fetchSummary: async () => {
    set({ isLoading: true, error: null });
    try {
      const summary = await monitorService.getSummary();
      set({ summary, isLoading: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : '获取监控摘要失败',
        isLoading: false,
      });
    }
  },

  fetchAlerts: async (acknowledged?: boolean) => {
    set({ isLoading: true, error: null });
    try {
      const alerts = await monitorService.getAlerts(acknowledged);
      set({ alerts, isLoading: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : '获取告警列表失败',
        isLoading: false,
      });
    }
  },

  fetchSystemHealth: async () => {
    set({ isLoading: true, error: null });
    try {
      const systemHealth = await monitorService.getSystemHealth();
      set({ systemHealth, isLoading: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : '获取系统健康状态失败',
        isLoading: false,
      });
    }
  },

  acknowledgeAlert: async (id: string) => {
    try {
      await monitorService.acknowledgeAlert(id);
      set((state) => ({
        alerts: state.alerts.map((alert) =>
          alert.id === id ? { ...alert, acknowledged: true } : alert
        ),
      }));
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : '确认告警失败',
      });
    }
  },

  clearError: () => set({ error: null }),
}));