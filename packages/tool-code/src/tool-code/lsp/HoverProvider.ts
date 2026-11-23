import type { LSPToolImpl } from './LSPToolImpl';

export type HoverContent = {
  contents: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

export type HoverResult = {
  content: string;
  language?: string;
  hasSignature: boolean;
  hasDocumentation: boolean;
};

export class HoverProvider {
  constructor(private lsp: LSPToolImpl) {}

  async getHover(
    documentUri: string,
    line: number,
    character: number
  ): Promise<HoverResult | null> {
    try {
      const raw = await this.lsp.sendRequest('textDocument/hover', {
        textDocument: { uri: documentUri },
        position: { line, character },
      });
      if (!raw) return null;

      const content = this.extractContent(raw);
      if (!content) return null;

      const hasSignature =
        /\b(\([^)]*\)|[A-Z]\w+\(|\w+\s*\(|\bclass\b|\bfunction\b|\binterface\b|\benum\b)/.test(
          content
        );
      const hasDocumentation =
        content.length > 100 ||
        /@(param|return|throws|see|example)/.test(content);

      return {
        content,
        hasSignature,
        hasDocumentation,
      };
    } catch {
      return null;
    }
  }

  private extractContent(raw: any): string {
    if (typeof raw === 'string') return raw;

    if (raw.contents) {
      if (typeof raw.contents === 'string') return raw.contents;

      if (Array.isArray(raw.contents)) {
        return raw.contents
          .map((item: any) => {
            if (typeof item === 'string') return item;
            if (item.value) return item.value;
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }

      if (raw.contents.value) {
        return raw.contents.value;
      }

      if (raw.contents.kind === 'markdown' && raw.contents.value) {
        return raw.contents.value;
      }
    }

    return '';
  }
}
