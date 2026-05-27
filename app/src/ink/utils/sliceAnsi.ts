export default function sliceAnsi(
  text: string,
  start: number,
  end?: number
): string {
  return text.slice(start, end);
}
