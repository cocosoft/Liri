import type { LSPToolImpl } from './LSPToolImpl'

export type ReferenceLocation = {
  uri: string
  filePath: string
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
}

export type ReferenceResult = {
  locations: ReferenceLocation[]
  fileCount: number
}

export class ReferenceFinder {
  constructor(private lsp: LSPToolImpl) {}

  async findReferences(
    documentUri: string,
    line: number,
    character: number,
    includeDeclaration: boolean = true,
  ): Promise<ReferenceResult> {
    try {
      const raw = await this.lsp.sendRequest('textDocument/references', {
        textDocument: { uri: documentUri },
        position: { line, character },
        context: { includeDeclaration },
      })
      if (!raw) return { locations: [], fileCount: 0 }

      const locations: any[] = Array.isArray(raw) ? raw : []
      const normalized = locations.map((l: any) => this.normalizeLocation(l))
      const files = new Set(normalized.map(l => l.filePath))

      return { locations: normalized, fileCount: files.size }
    } catch {
      return { locations: [], fileCount: 0 }
    }
  }

  async findReferencesBatch(
    documentUri: string,
    symbols: Array<{ line: number; character: number }>,
  ): Promise<Map<string, ReferenceResult>> {
    const results = new Map<string, ReferenceResult>()
    for (const sym of symbols) {
      const key = `${sym.line}:${sym.character}`
      const result = await this.findReferences(documentUri, sym.line, sym.character)
      results.set(key, result)
    }
    return results
  }

  private normalizeLocation(loc: any): ReferenceLocation {
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
}
