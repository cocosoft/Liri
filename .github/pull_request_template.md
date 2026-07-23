## Type of Change
- [ ] Bug fix (non-breaking)
- [ ] New feature
- [ ] Architecture refactoring (requires second reviewer)
- [ ] Documentation
- [ ] CI / Tooling

## Summary
<!-- 用 1-2 句话描述变更内容 -->

## Validation
- [ ] `bun run typecheck` passes
- [ ] Relevant tests pass (`bun run test -- <test-pattern>`)
- [ ] No new `@ts-ignore` or `as any` casts
- [ ] No hardcoded model/provider/api-key values
- [ ] Logger has `module` field defined

## Context Module Checklist (if applicable)
- [ ] No `console.log` added (use Logger)
- [ ] No error swallowed silently (use `handleError()`)
- [ ] No new `charsPerToken` constant (use `TokenEstimator`)
- [ ] No new `CostTracker` instance (use existing singleton)
- [ ] Persistence: `serialize()` / `hydrate()` compatibility tested

## Reviewer Notes
<!-- 需要审阅者重点关注的区域 -->
