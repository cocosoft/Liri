export type SymbolContextResult = {
  symbol: string;
  enclosingFunction: string | null;
  enclosingClass: string | null;
  line: number;
  character: number;
  filePath: string;
  contextLines: string[];
  contextBefore: string;
  contextAfter: string;
};

const MAX_LINE_LENGTH = 200;

export class SymbolContext {
  async getSymbolContext(
    fileContent: string,
    line: number,
    character: number,
    filePath: string = ''
  ): Promise<SymbolContextResult> {
    const lines = fileContent.split('\n');
    const lineContent = lines[line] || '';

    const symbol = this.extractSymbolAt(lineContent, character);
    const enclosingFunction = this.findEnclosingFunction(lines, line);
    const enclosingClass = this.findEnclosingClass(lines, line);

    const contextStart = Math.max(0, line - 3);
    const contextEnd = Math.min(lines.length, line + 4);
    const contextLines = lines
      .slice(contextStart, contextEnd)
      .map((l) => l.slice(0, MAX_LINE_LENGTH));

    return {
      symbol,
      enclosingFunction,
      enclosingClass,
      line,
      character,
      filePath,
      contextLines,
      contextBefore: lines.slice(Math.max(0, line - 3), line).join('\n'),
      contextAfter: lines
        .slice(line + 1, Math.min(lines.length, line + 4))
        .join('\n'),
    };
  }

  private extractSymbolAt(line: string, character: number): string {
    if (!line || character < 0 || character >= line.length) return '';

    const symbolPattern = /[\w$'!]+|[+\-*/%&|^~<>=]+/g;
    let match: RegExpExecArray | null;

    while ((match = symbolPattern.exec(line)) !== null) {
      if (
        character >= match.index &&
        character < match.index + match[0].length
      ) {
        return match[0].slice(0, 30);
      }
    }

    return line.slice(
      Math.max(0, character - 5),
      Math.min(line.length, character + 5)
    );
  }

  private findEnclosingFunction(
    lines: string[],
    targetLine: number
  ): string | null {
    for (let i = targetLine; i >= 0; i--) {
      const trimmed = lines[i].trim();
      const funcMatch = trimmed.match(
        /(?:function\s+(\w+)|(\w+)\s*\([^)]*\)\s*\{|(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|(\w+)\s*=\s*(?:async\s*)?\w+\s*=>)/
      );
      if (funcMatch) {
        return (
          funcMatch[1] || funcMatch[2] || funcMatch[3] || funcMatch[4] || null
        );
      }

      const defMatch = trimmed.match(
        /(?:async\s+)?def\s+(\w+)\s*\(|class\s+(\w+)/
      );
      if (defMatch) {
        return defMatch[1] || defMatch[2] || null;
      }
    }
    return null;
  }

  private findEnclosingClass(
    lines: string[],
    targetLine: number
  ): string | null {
    for (let i = targetLine; i >= 0; i--) {
      const trimmed = lines[i].trim();
      const classMatch = trimmed.match(
        /(?:class|interface|enum|struct)\s+(\w+)/
      );
      if (classMatch) {
        return classMatch[1];
      }
    }
    return null;
  }

  async fromFileContent(
    content: string,
    line: number,
    character: number,
    filePath: string = ''
  ): Promise<SymbolContextResult> {
    return this.getSymbolContext(content, line, character, filePath);
  }
}
