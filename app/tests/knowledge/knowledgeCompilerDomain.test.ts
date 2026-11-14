import { afterAll, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

describe('KnowledgeCompiler domain output', () => {
  const home = mkdtempSync(
    join(import.meta.dir, '.knowledge-compiler-domain-')
  );
  const previousHome = process.env.LIRI_HOME;

  afterAll(() => {
    if (previousHome === undefined) delete process.env.LIRI_HOME;
    else process.env.LIRI_HOME = previousHome;
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // Windows may keep the database handle open until the test process exits.
    }
  });

  it('writes artifacts to the selected domain and keeps the global default', async () => {
    process.env.LIRI_HOME = home;
    const globalRoot = join(home, 'knowledge');
    const domainRoot = join(globalRoot, 'domains', 'finance');
    mkdirSync(join(domainRoot, 'raw'), { recursive: true });
    mkdirSync(join(globalRoot, 'raw'), { recursive: true });
    writeFileSync(join(domainRoot, 'raw', 'source.md'), 'domain source');
    writeFileSync(join(globalRoot, 'raw', 'source.md'), 'global source');

    const { KnowledgeCompiler } =
      await import('../../src/knowledge/KnowledgeCompiler');
    const { WikiLinter } = await import('../../src/knowledge/lint/WikiLinter');
    const compiler = new KnowledgeCompiler({} as never);
    const outputs: string[] = [];
    const lintTargets: Array<[string | undefined, string | undefined]> = [];
    const originalLintRun = WikiLinter.prototype.run;
    WikiLinter.prototype.run = async function (wikiDir, domainName) {
      lintTargets.push([wikiDir, domainName]);
      return { results: [], summary: { error: 0, warning: 0, info: 0 } };
    };
    (
      compiler as unknown as {
        compileFile: (rawFile: string) => Promise<string[]>;
      }
    ).compileFile = async (rawFile) => {
      const output = join(
        (compiler as unknown as { knowledgeRoot: string }).knowledgeRoot,
        `${rawFile.split(/[\\/]/).pop()}.compiled.md`
      );
      writeFileSync(output, 'compiled artifact');
      outputs.push(output);
      return [output];
    };

    try {
      await compiler.compile({ domain: 'finance', model: 'test' });
      expect(existsSync(join(domainRoot, 'source.md.compiled.md'))).toBe(true);
      expect(existsSync(join(globalRoot, 'source.md.compiled.md'))).toBe(false);
      expect(outputs[0]).toBe(join(domainRoot, 'source.md.compiled.md'));
      expect(lintTargets[0]).toEqual([domainRoot, 'finance']);

      await compiler.compile({ model: 'test' });
      expect(existsSync(join(globalRoot, 'source.md.compiled.md'))).toBe(true);
      expect(outputs[1]).toBe(join(globalRoot, 'source.md.compiled.md'));
      expect(lintTargets[1]).toEqual([globalRoot, undefined]);
    } finally {
      WikiLinter.prototype.run = originalLintRun;
    }
  });
});
