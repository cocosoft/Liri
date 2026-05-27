/**
 * CLI Tagline
 * 对标OpenClaw cli/tagline.ts
 * 标语系统
 */

export interface TaglineConfig {
  showOnStartup?: boolean;
  randomize?: boolean;
  customTaglines?: string[];
  separator?: string;
}

const DEFAULT_TAGLINES = [
  'Your AI-powered development companion',
  'Code smarter, not harder',
  'Intelligent automation for modern development',
  'Bringing AI to your terminal',
  'Where ideas become code',
  'Supercharge your workflow',
  'The future of coding, today',
  'Building better software, together',
  'AI that understands your codebase',
  'Empowering developers with AI',
];

const SEASONAL_TAGLINES: Array<{
  month: number;
  day: number;
  tagline: string;
}> = [
  { month: 1, day: 1, tagline: 'Happy New Year! A fresh start for your code' },
  { month: 12, day: 25, tagline: 'Merry Christmas! Code with joy' },
  { month: 10, day: 31, tagline: 'Spooky code... Happy Halloween!' },
  { month: 2, day: 14, tagline: "Love your code! Happy Valentine's Day" },
  { month: 3, day: 14, tagline: 'Happy Pi Day! 3.14159...' },
];

export class TaglineManager {
  private taglines: string[];
  private config: Required<TaglineConfig>;
  private currentIndex: number = 0;

  constructor(config?: TaglineConfig) {
    this.config = {
      showOnStartup: config?.showOnStartup ?? true,
      randomize: config?.randomize ?? true,
      customTaglines: config?.customTaglines ?? [],
      separator: config?.separator ?? ' · ',
    };

    this.taglines = [...DEFAULT_TAGLINES, ...this.config.customTaglines];
  }

  get(): string {
    const seasonal = this.getSeasonalTagline();
    if (seasonal) return seasonal;

    if (this.config.randomize) {
      return this.taglines[Math.floor(Math.random() * this.taglines.length)];
    }

    const tagline = this.taglines[this.currentIndex % this.taglines.length];
    this.currentIndex++;
    return tagline;
  }

  getAll(): string[] {
    return [...this.taglines];
  }

  add(tagline: string): void {
    this.taglines.push(tagline);
  }

  remove(tagline: string): boolean {
    const index = this.taglines.indexOf(tagline);
    if (index === -1) return false;
    this.taglines.splice(index, 1);
    return true;
  }

  setCustomTaglines(taglines: string[]): void {
    this.config.customTaglines = taglines;
    this.taglines = [...DEFAULT_TAGLINES, ...taglines];
  }

  getFormatted(prefix?: string): string {
    const tagline = this.get();
    return prefix ? `${prefix}${this.config.separator}${tagline}` : tagline;
  }

  private getSeasonalTagline(): string | null {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();

    for (const seasonal of SEASONAL_TAGLINES) {
      if (seasonal.month === month && seasonal.day === day) {
        return seasonal.tagline;
      }
    }

    return null;
  }

  reset(): void {
    this.taglines = [...DEFAULT_TAGLINES];
    this.currentIndex = 0;
  }

  getCount(): number {
    return this.taglines.length;
  }
}

let defaultManager: TaglineManager | null = null;

export function getTaglineManager(config?: TaglineConfig): TaglineManager {
  if (!defaultManager) {
    defaultManager = new TaglineManager(config);
  }
  return defaultManager;
}

export function resetTaglineManager(): void {
  defaultManager = null;
}
