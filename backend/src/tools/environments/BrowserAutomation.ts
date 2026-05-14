export interface BrowserPageResult {
  url: string;
  title: string;
  content: string;
  selectorCount: Record<string, number>;
}

export interface BrowserAutomationProvider {
  readonly name: string;

  initialize(): Promise<void>;
  navigate(url: string): Promise<BrowserPageResult>;
  click(selector: string): Promise<BrowserPageResult>;
  typeText(selector: string, text: string): Promise<void>;
  scroll(direction: 'up' | 'down', amount?: number): Promise<void>;
  takeScreenshot(options?: { fullPage?: boolean }): Promise<string>;
  executeScript(script: string): Promise<unknown>;
  close(): Promise<void>;
}

export abstract class BaseBrowserProvider implements BrowserAutomationProvider {
  abstract readonly name: string;

  abstract initialize(): Promise<void>;

  abstract navigate(url: string): Promise<BrowserPageResult>;

  abstract click(selector: string): Promise<BrowserPageResult>;

  abstract typeText(selector: string, text: string): Promise<void>;

  abstract scroll(direction: 'up' | 'down', amount?: number): Promise<void>;

  abstract takeScreenshot(options?: { fullPage?: boolean }): Promise<string>;

  abstract executeScript(script: string): Promise<unknown>;

  abstract close(): Promise<void>;
}

export class BrowserProviderRegistry {
  private providers: Map<string, BrowserAutomationProvider> = new Map();

  register(provider: BrowserAutomationProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): BrowserAutomationProvider | undefined {
    return this.providers.get(name);
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }
}

export const browserProviderRegistry = new BrowserProviderRegistry();
