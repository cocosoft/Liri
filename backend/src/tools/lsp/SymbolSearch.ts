import type { LSPToolImpl } from './LSPToolImpl'

export type SymbolKind =
  | 'File' | 'Module' | 'Namespace' | 'Package' | 'Class'
  | 'Method' | 'Property' | 'Field' | 'Constructor' | 'Enum'
  | 'Interface' | 'Function' | 'Variable' | 'Constant' | 'String'
  | 'Number' | 'Boolean' | 'Array' | 'Object' | 'Key'
  | 'Null' | 'EnumMember' | 'Struct' | 'Event' | 'Operator'
  | 'TypeParameter'

export type SymbolInfo = {
  name: string
  kind: SymbolKind
  location: SymbolLocation
  containerName?: string
  detail?: string
}

export type SymbolLocation = {
  uri: string
  filePath: string
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
}

export type SymbolSearchResult = {
  symbol: SymbolInfo
  matchedIn: 'name' | 'container' | 'detail'
}

const SYMBOL_KIND_MAP: Record<number, SymbolKind> = {
  1: 'File', 2: 'Module', 3: 'Namespace', 4: 'Package', 5: 'Class',
  6: 'Method', 7: 'Property', 8: 'Field', 9: 'Constructor', 10: 'Enum',
  11: 'Interface', 12: 'Function', 13: 'Variable', 14: 'Constant',
  15: 'String', 16: 'Number', 17: 'Boolean', 18: 'Array', 19: 'Object',
  20: 'Key', 21: 'Null', 22: 'EnumMember', 23: 'Struct', 24: 'Event',
  25: 'Operator', 26: 'TypeParameter',
}

function mapSymbolKind(raw: number): SymbolKind {
  return SYMBOL_KIND_MAP[raw] || 'Variable'
}

export class SymbolSearch {
  constructor(private lsp: LSPToolImpl) {}

  async searchWorkspaceSymbols(
    query: string,
    maxResults: number = 50,
  ): Promise<SymbolSearchResult[]> {
    if (!query.trim()) return []

    try {
      const raw = await this.lsp.sendRequest('workspace/symbol', { query })
      if (!raw) return []

      const symbols: any[] = Array.isArray(raw) ? raw : []
      return symbols
        .slice(0, maxResults)
        .map((s: any) => ({
          symbol: {
            name: s.name,
            kind: mapSymbolKind(s.kind),
            location: this.normalizeLocation(s.location),
            containerName: s.containerName,
            detail: s.detail,
          },
          matchedIn: query.toLowerCase() === (s.containerName || '').toLowerCase() ? 'container' : 'name',
        }))
    } catch {
      return []
    }
  }

  async getDocumentSymbols(
    documentUri: string,
  ): Promise<SymbolInfo[]> {
    try {
      const raw = await this.lsp.sendRequest('textDocument/documentSymbol', {
        textDocument: { uri: documentUri },
      })
      if (!raw) return []

      const items: any[] = Array.isArray(raw) ? raw : []
      return this.flattenDocumentSymbols(items)
    } catch {
      return []
    }
  }

  private flattenDocumentSymbols(
    symbols: any[],
  ): SymbolInfo[] {
    const result: SymbolInfo[] = []
    for (const s of symbols) {
      if (s.location || s.range) {
        const location = s.location || {
          uri: '',
          range: s.range || { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        }
        result.push({
          name: s.name,
          kind: mapSymbolKind(s.kind),
          location: this.normalizeLocation(location),
          containerName: s.containerName,
          detail: s.detail,
        })
      }
      if (s.children && Array.isArray(s.children)) {
        result.push(...this.flattenDocumentSymbols(s.children))
      }
    }
    return result
  }

  private normalizeLocation(loc: any): SymbolLocation {
    const uri = loc.uri || ''
    let filePath = uri
    if (filePath.startsWith('file://')) {
      filePath = decodeURIComponent(filePath.replace(/^file:\/\//, ''))
      if (/^\/[A-Za-z]:/.test(filePath)) {
        filePath = filePath.slice(1)
      }
    }

    return {
      uri,
      filePath: filePath.replace(/\\/g, '/'),
      range: {
        start: {
          line: loc.range?.start?.line ?? 0,
          character: loc.range?.start?.character ?? 0,
        },
        end: {
          line: loc.range?.end?.line ?? 0,
          character: loc.range?.end?.character ?? 0,
        },
      },
    }
  }

  async filterSymbols(
    query: string,
    symbols: SymbolInfo[],
  ): Promise<SymbolInfo[]> {
    const q = query.toLowerCase()
    return symbols.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        (s.containerName || '').toLowerCase().includes(q),
    )
  }
}
