import { BaseConverter } from '../engine/BaseConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_FALLBACK } from '../engine/types';

const ACCEPTED_MIME_PREFIXES = ['text/', 'application/json'];
const ACCEPTED_EXTENSIONS = [
  '.txt',
  '.text',
  '.md',
  '.markdown',
  '.json',
  '.jsonl',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.log',
  '.env',
];

export class PlainTextConverter extends BaseConverter {
  override readonly name = 'plain_text';
  override readonly priority = PRIORITY_FALLBACK;
  override readonly supportedExtensions = ACCEPTED_EXTENSIONS;
  override readonly supportedMimeTypes = ACCEPTED_MIME_PREFIXES.map(
    (p) => `${p}*`
  );

  async convert(context: ConversionContext): Promise<ConversionResult> {
    const content =
      typeof context.content === 'string'
        ? context.content
        : context.content.toString('utf-8');

    const firstLine = content.split('\n')[0]?.trim() || '';
    const title = firstLine.startsWith('#')
      ? firstLine.replace(/^#+\s*/, '')
      : undefined;

    return { markdown: content, title };
  }
}
