import { getBackendBaseUrl } from "./backendUrl";

type EventHandler = (data: Record<string, unknown>) => void;

class SSEService {
  private eventSource: EventSource | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    if (this.eventSource) return;

    try {
      this.eventSource = new EventSource(`${getBackendBaseUrl()}/v1/events`);

      this.eventSource.onopen = () => {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.eventSource.onerror = () => {
        this.disconnect();
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      };

      this.eventSource.onmessage = (e) => {
        this.dispatch("message", this.parse(e.data));
      };

      this.eventSource.addEventListener("heartbeat", (e: Event) => {
        const msg = e as MessageEvent;
        this.dispatch("heartbeat", this.parse(msg.data));
      });
    } catch {
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    }
  }

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private dispatch(event: string, data: Record<string, unknown>): void {
    this.handlers.get(event)?.forEach((h) => h(data));
  }

  private parse(data: string): Record<string, unknown> {
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
}

export const sseService = new SSEService();
