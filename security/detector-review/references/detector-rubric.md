# Detector Rubric

Use this rubric before writing any detector.

## Quick Choice

| Detector                     | Use when                                                                                                                      | Good signs                                                                                                                                                                                                               | Reject when                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Reusable OpenGrep rule (`A`) | The bug has a local structural shape that can generalize to similar vulnerabilities, not just the exact advisory.             | Dangerous API is explicit, missing guard is visible in the AST, or the bug is a stable anti-pattern like shell string construction, direct unsafe fetch, unsafe path join, or privileged route with no canonical helper. | The rule would need file-specific names, exact literals, repo-specific trivia, or a near-copy of the exact advisory snippet to work. |
| Custom CodeQL (`B`)          | The bug depends on flow through wrappers, helper chains, trusted vs untrusted value movement, or source-to-sink reachability. | You can name sources, sinks, and maybe barriers in one sentence. The behavior survives renames and helper indirection.                                                                                                   | The logic is mostly state-machine, retry, race, or product policy, with no stable dataflow story.                                    |
| Broad OpenGrep (`C`)         | Precise detection is hard, but broad highlighting can show suspicious code for human review.                                  | You can ask a wide question like "where do privileged routes skip the normal auth helper?" or "where do we fetch URLs outside the guarded helper?".                                                                      | The rule would effectively match the entire codebase or cannot be reviewed meaningfully by a human.                                  |

## Decision Rules

Pick `A` only if all of these are true:

- it catches the seeded or real positive
- it catches a non-identical same-family positive, not just a variable-rename clone
- it misses at least one close safe control
- it still makes sense if identifiers are renamed
- it can plausibly catch similar future bugs

Pick `B` only if all of these are true:

- the vulnerability can be described as lower-trust data reaching a sink
- helper traversal matters enough that AST matching is not the right tool
- you can define or approximate barriers without encoding the exact advisory diff

Pick `C` when at least one of these is true:

- semantic intent matters more than local syntax
- exact correctness requires human review
- you still want a cheap "show me suspicious shortcuts" pass

Pick none of `A`, `B`, `C` when the bug is primarily:

- stale state or reload behavior
- race or interleaving sensitive
- approval or policy logic with no stable local shape
- product-trust semantics better enforced by tests or runtime assertions

## Validation Bar

`A` reusable OpenGrep rule:

- hit positive
- hit a same-family variant positive
- miss close negative
- scan repo
- classify repo hits as `real`, `interesting`, or `noise`

`B` CodeQL query:

- hit positive fixture or recovered vulnerable path
- miss safe control
- run on repo or targeted database when feasible
- explain sources, sinks, and barriers in plain English

`C` broad OpenGrep rule:

- hit positive
- run on repo
- show the user a small reviewed sample of findings
- explicitly label it as `review aid` if noise is expected

## Anti-Patterns

Do not ship:

- file-path-anchored rules unless the path names the public boundary itself
- one-off identifier matching with no semantic value
- exact-regression rules disguised as reusable family detectors
- CodeQL queries that only restate a built-in query with zero narrowing
- broad OpenGrep rules that match every handler, every fetch, or every exec
