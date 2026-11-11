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

TypeScript on NestJS, running on the active Node.js LTS, with Bun as the package manager.
PostgreSQL with PostGIS, accessed through Kysely.

`docs/architecture.md` describes how the code is structured, following
domain-driven-hexagon. Read it before adding a module or a use case. The conformance test
validates real responses against the pinned OpenAPI document, as described there. Why this
stack was chosen is in ADR 0006 in the system repository.

## Commands

The contract package comes from GitHub Packages, so installing needs `GITHUB_TOKEN` set to
a token with `read:packages` (`export GITHUB_TOKEN=$(gh auth token)` after
`gh auth refresh -s read:packages`). Copy `.env.example` to `.env` for local settings; the
scripts load it through Node's `--env-file`, and a variable already set in the environment
wins.

Node.js (`.node-version`) and Docker are required. `bun run` falls back to Bun when `node`
is not installed, and under Bun Testcontainers hangs, so the test setup refuses to run there.

```sh
bun install
docker compose up -d --wait            # PostGIS on :5432, Keycloak on :8080
bun run build && bun run migrate       # apply pending migrations; `migrate down` reverts one
bun run set-role 00000000-0000-4000-8000-000000000001 admin   # make the realm's `admin` user an admin
bun run dev          # watch mode on :8000
bun run build && bun run start
bun run typecheck
bun run lint
bun run test         # specs against PostGIS and Keycloak from Testcontainers, response validation on
```

Keycloak's realm comes from `keycloak/phenomena-atlas-realm.json`, imported when the
container is created. It has the web client, a `dev` user with password `dev` and an `admin`
user with password `admin` and a fixed id, so `set-role` can make it an admin before it
first signs in. The Keycloak admin console, a separate login, is at
http://localhost:8080/admin with `admin`/`admin`. Recreate the container after editing the
file: `docker compose up -d --force-recreate keycloak`. These credentials are for local
development only.

`bun run set-role <email | identity provider user id> <user | analyst | admin>` is how an
operator sets a role outside the API: making the first admin of an environment, or
recovering when every admin is lost. An email only finds someone who has signed in at
least once; an identity provider id creates the account if needed.

Bun uses the isolated linker (`bunfig.toml`). The hoisted layout resolved
`express-openapi-validator`'s `ajv-draft-04` against ESLint's `ajv` 6 and broke at startup.

## Conventions

- All project text is English: code, comments, commits, documentation.
- `main` is production, `develop` integrates the sprint (ADR 0005 in the system
  repository). Branch off `develop` and open pull requests into it. `main` only takes
  releases from `develop` and fixes from `hotfix/*`.
- Domain rules are enforced here. A client-side check is a convenience, never the thing
  that protects an invariant.

## `main` and `develop` are protected

This repository is public. Both branches require a pull request and one approving
review, and cannot be deleted or force-pushed. `main` also only accepts merge commits
and requires the `source-branch` check, which rejects pull requests that do not come
from `develop` or `hotfix/*`. Organisation admins can bypass all of it, including
pushing straight to `main`; that is an escape hatch, not a route.

> TODO: no test check is required here yet, because there is no test suite yet. Once
> this component has a test suite, add it to both rulesets as a required check. Until then
> a pull request can be merged with failing tests, because nothing is watching.
