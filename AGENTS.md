# Phenomena Atlas API

The API behind Phenomena Atlas. It owns the domain and is the only component with
database access.

## Read the system context first

This repository is one component of a larger product. The context that explains how it
fits together lives in the system repository, `QuetzalSoft/phenomena-atlas`:

- `contracts/main.tsp` - the contract this API must implement (compiled to
  `contracts/generated/openapi.yaml`, which is the document to read)
- `docs/domain.md` - the shared vocabulary
- `docs/release.md` - how a change crossing components is shipped
- `docs/architecture.md` - why things are split this way

If this repository is cloned on its own, that context is missing. Clone the workspace
instead and this becomes automatic:

```sh
git clone git@github.com:QuetzalSoft/phenomena-atlas.git
cd phenomena-atlas && ./scripts/bootstrap.sh
```

That places this repository at `phenomena-atlas/api/`, where the system `AGENTS.md` is
inherited from the parent directory.

## The contract comes first

This API does not define its own interface. `contracts/main.tsp` in the system
repository does, and it is written before the implementation. It is consumed here as the
pinned package `@quetzalsoft/phenomena-atlas-contract`, which carries both the OpenAPI
document and TypeScript types.

Changing what this API exposes means changing the contract first, in a separate pull
request, in the system repository. Implementing a response shape that the pinned
contract version does not describe is a bug even when every test here passes.

The conformance test that proves this API matches its contract is a blocking test. It
is never skipped, never marked flaky, and never merged red.

## Stack

TypeScript.

> TODO: framework, database, package manager, and the test, lint and run commands. Fill
> this in with the first real commit. Keep it to the commands a new contributor would
> otherwise have to find by reading config files.
>
> The framework choice also decides how the conformance test is implemented. Whatever is
> picked must be able to validate real responses against the pinned OpenAPI document; do
> not choose a framework without an answer to that.

## Conventions

- All project text is English: code, comments, commits, documentation.
- `main` is production, `develop` integrates the sprint (ADR 0005 in the system
  repository). Branch off `develop` and open pull requests into it. `main` only takes
  releases from `develop` and fixes from `hotfix/*`.

## `main` and `develop` are protected

This repository is public. Both branches require a pull request and one approving
review, and cannot be deleted or force-pushed. `main` also only accepts merge commits
and requires the `source-branch` check, which rejects pull requests that do not come
from `develop` or `hotfix/*`. Organisation admins can bypass all of it, including
pushing straight to `main`; that is an escape hatch, not a route.

> TODO: no test check is required here yet, because there is no test suite yet. Once
> this component has a test suite, add it to both rulesets as a required check. Until then
> a pull request can be merged with failing tests, because nothing is watching.
- Domain rules are enforced here. A client-side check is a convenience, never the thing
  that protects an invariant.
