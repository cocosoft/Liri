import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import type { CommandMatch, CommandExecutor } from './types.js';

export class LocalCommandExecutor implements CommandExecutor {
  private allowedCommands: Set<string>;
  private allowedDirectories: string[];
  private maxOutputLength: number;

  constructor(
    allowedCommands: string[] = [
      'ls',
      'dir',
      'cat',
      'type',
      'echo',
      'date',
      'time',
      'pwd',
      'cd',
    ],
    allowedDirectories?: string[],
    maxOutputLength: number = 10000
  ) {
    this.allowedCommands = new Set(allowedCommands.map((c) => c.toLowerCase()));
    this.allowedDirectories = allowedDirectories || [process.cwd()];
    this.maxOutputLength = maxOutputLength;
  }

  async execute(match: CommandMatch, context?: any): Promise<string> {
    const { action, args } = match;

    switch (action) {
      case 'create':
        return this.handleCreate(args, context);
      case 'delete':
        return this.handleDelete(args, context);
      case 'read':
        return this.handleRead(args, context);
      case 'write':
        return this.handleWrite(args, context);
      case 'execute':
        return this.handleExecute(args, context);
      default:
        return `Unknown action: ${action}`;
    }
  }

  private async handleCreate(
    args?: Record<string, string>,
    context?: any
  ): Promise<string> {
    const filePath = args?.path || context?.path;

    if (!filePath) {
      return 'Error: path is required for create action';
    }

    if (!this.isPathAllowed(filePath)) {
      return `Error: path not allowed: ${filePath}`;
    }

    try {
      const resolvedPath = path.resolve(filePath);
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.writeFile(resolvedPath, '', 'utf-8');
      return `Created: ${resolvedPath}`;
    } catch (error) {
      return `Error creating file: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async handleDelete(
    args?: Record<string, string>,
    context?: any
  ): Promise<string> {
    const filePath = args?.path || context?.path;

    if (!filePath) {
      return 'Error: path is required for delete action';
    }

    if (filePath.includes('..') || filePath.includes('~')) {
      return 'Error: path traversal not allowed';
    }

    return 'Error: delete operation requires explicit confirmation and is disabled by default';
  }

  private async handleRead(
    args?: Record<string, string>,
    context?: any
  ): Promise<string> {
    const filePath = args?.path || context?.path;

    if (!filePath) {
      return 'Error: path is required for read action';
    }

    if (!this.isPathAllowed(filePath)) {
      return `Error: path not allowed: ${filePath}`;
    }

    try {
      const resolvedPath = path.resolve(filePath);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      return content;
    } catch (error) {
      return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async handleWrite(
    args?: Record<string, string>,
    context?: any
  ): Promise<string> {
    const filePath = args?.path || context?.path;
    const content = args?.content || context?.content;

    if (!filePath) {
      return 'Error: path is required for write action';
    }

    if (!this.isPathAllowed(filePath)) {
      return `Error: path not allowed: ${filePath}`;
    }

    try {
      const resolvedPath = path.resolve(filePath);
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.writeFile(resolvedPath, content || '', 'utf-8');
      return `Written to: ${resolvedPath}`;
    } catch (error) {
      return `Error writing file: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private isPathAllowed(filePath: string): boolean {
    try {
      const resolved = path.resolve(filePath);
      return this.allowedDirectories.some((dir) => {
        const resolvedDir = path.resolve(dir);
        return (
          resolved.startsWith(resolvedDir + path.sep) ||
          resolved === resolvedDir
        );
      });
    } catch {
      return false;
    }
  }

  addAllowedDirectory(dir: string): void {
    const resolved = path.resolve(dir);
    if (!this.allowedDirectories.includes(resolved)) {
      this.allowedDirectories.push(resolved);
    }
  }

  getAllowedDirectories(): string[] {
    return [...this.allowedDirectories];
  }

  private async handleExecute(
    args?: Record<string, string>,
    context?: any
  ): Promise<string> {
    const command = args?.command || context?.command;
    const commandArgs = args?.args || context?.args;

    if (!command) {
      return 'Error: command is required for execute action';
    }

    if (!this.isCommandAllowed(command)) {
      return `Error: command not allowed: ${command}`;
    }

    return this.executeCommand(command, commandArgs);
  }

  private isCommandAllowed(command: string): boolean {
    return this.allowedCommands.has(command.toLowerCase());
  }

  private executeCommand(command: string, args?: string[]): Promise<string> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        shell: true,
        timeout: 5000,
      });

      let output = '';
      let errorOutput = '';

      proc.stdout?.on('data', (data) => {
        output += data.toString();
        if (output.length > this.maxOutputLength) {
          output =
            output.substring(0, this.maxOutputLength) + '\n... (truncated)';
          proc.kill();
        }
      });

      proc.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(output || 'Command executed successfully');
        } else {
          resolve(`Error: ${errorOutput || `exit code ${code}`}`);
        }
      });

      proc.on('error', (err) => {
        resolve(`Error: ${err.message}`);
      });

      setTimeout(() => {
        proc.kill();
        resolve('Error: command timeout');
      }, 5000);
    });
  }

  allowCommand(command: string): void {
    this.allowedCommands.add(command.toLowerCase());
  }

  disallowCommand(command: string): void {
    this.allowedCommands.delete(command.toLowerCase());
  }

  isAllowed(command: string): boolean {
    return this.allowedCommands.has(command.toLowerCase());
  }

  getAllowedCommands(): string[] {
    return Array.from(this.allowedCommands);
  }
}

export function createCommandExecutor(
  allowedCommands?: string[],
  allowedDirectories?: string[]
): LocalCommandExecutor {
  return new LocalCommandExecutor(allowedCommands, allowedDirectories);
}
