> Historical policy context: current implementation is described in [the formal specification](specification/INDEX.md). Early OPEN/PROPOSED items are not claims about the present implementation.

# Changes, ADRs and release gates

## An architecture decision request (ADR) should contain

```
Title / status (OPEN, PROPOSED, APPROVED, SUPERSEDED)
Context / goal / user-visible effect
Alternatives (incl. doing nothing)
Costs: code, maintenance, storage, network, privacy, migration
Recommendation and rationale
Rollback/reversibility
Affected approved D-IDs, affected files, acceptance tests
Product owner decision and date
```

## Change classes

- Minor internal and test-only refactor: Codex may implement within active approved task and report.
- New dependency/API (not affecting privacy/cost/architecture): propose, record license/version and impact, follow phase approval.
- Persistent schema contract; new online data transfer; hosted backend; deletion/replacement; D-ID conflict: stop for human approval.
- UX visual tokens and layout: exploratory until design decision, never hardcode as 'approved' design system.

## Evidence and review

Every phase submission includes: requirement coverage matrix, changed files, tests actually run, fixtures used, external network audit observations, risks/known gaps, migration/rollback conditions and unresolved decisions. Record failures rather than silently patching standards.
