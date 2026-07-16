/**
 * 办公模块可选依赖类型声明
 * nodemailer 和 imapflow 仅在 enterprise 构建中可用
 * 运行时通过动态 import() 加载，此处声明类型仅供参考
 */

declare module 'nodemailer' {
  const nodemailer: any;
  export = nodemailer;
}

declare module 'imapflow' {
  export class ImapFlow {
    constructor(config: Record<string, unknown>);
    connect(): Promise<void>;
    logout(): Promise<void>;
    mailboxOpen(mailbox: string): Promise<{ exists: number }>;
    fetch(range: { start: number; end: number }, options: Record<string, unknown>): AsyncIterable<any>;
    search(query: Record<string, unknown>): Promise<any[]>;
  }
}
