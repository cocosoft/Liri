import { createHash } from 'node:crypto';

export interface SkillGuardResult {
  valid: boolean;
  errors: string[];
}

export class SkillGuard {
  private allowedSigners: Set<string> = new Set();

  addSigner(signerId: string): void {
    this.allowedSigners.add(signerId);
  }

  removeSigner(signerId: string): void {
    this.allowedSigners.delete(signerId);
  }

  getSigners(): string[] {
    return Array.from(this.allowedSigners);
  }

  verify(content: string, signature: string): SkillGuardResult {
    const errors: string[] = [];

    if (!signature) {
      errors.push('Missing signature');
      return { valid: false, errors };
    }

    const expectedHash = this.hashContent(content);
    if (signature !== expectedHash) {
      errors.push('Signature mismatch: content may be tampered');
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }

  sign(content: string): string {
    return this.hashContent(content);
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
}

export const skillGuard = new SkillGuard();
