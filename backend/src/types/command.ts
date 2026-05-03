export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  execute(args: string[], context?: Record<string, unknown>): Promise<void>;
}
