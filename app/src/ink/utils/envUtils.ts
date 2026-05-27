export { isEnvTruthy } from '../../utils/envUtils.js';
export function gte(a: string, b: string): boolean {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return true;
    if (numA < numB) return false;
  }
  return true;
}
