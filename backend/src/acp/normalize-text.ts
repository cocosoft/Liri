export function normalizeText(text: string): string {
  return text.trim();
}

export function isBlank(text: string | null | undefined): boolean {
  if (text == null) {
    return true;
  }
  return text.trim().length === 0;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '...';
}
