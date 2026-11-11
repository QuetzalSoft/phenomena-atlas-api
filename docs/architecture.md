# API architecture

How this API is structured internally. How it fits into the product is in
`docs/architecture.md` in the system repository, and why this structure was chosen is in
ADR 0006 there.

This document describes the target. Only part of it is built so far: the health slice, the
contract edge, access token checks in `src/libs/auth/`, the persistence plumbing in
`src/libs/db/`, the `account` module with authorization, and the `region` module with the
versioned region partition and its loader. Events, the `ddd/` base classes
and `dependency-cruiser` arrive when a module needs them.

## Sources and precedence

The structure follows [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon)
(DDH), built on NestJS. When DDH disagrees with the contract or an accepted ADR, the
contract and the ADR win. Every such case is listed under
[Deviations from DDH](#deviations-from-ddh).

DDH warns against applying all of its patterns everywhere, and that warning applies here.
Layers, boundaries and the contract rules below are mandatory. Value objects, separate
ports and extra abstractions must each earn their place.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js, active LTS |
| Package manager | Bun, for installing and running scripts only |
| Framework | NestJS on Express, with `@nestjs/cqrs` and `@nestjs/event-emitter` |
| Language | TypeScript 6 (see [Enforcement](#enforcement) for why not 7) |
| Database | PostgreSQL with PostGIS |
| Database client | Kysely over `pg` |
| Identity provider | Keycloak, self-hosted (ADR 0008 in the system repository) |
| Access token checks | `jose` |
| Request and response validation | `express-openapi-validator` |
| Expected failures | `Result` from `neverthrow` |
| Conformance | Schemathesis, plus response validation in the e2e suite |
| Layer enforcement | `dependency-cruiser` |

NestJS 12 ships as ES modules, so this code is ESM too. Examples written for older NestJS
versions, including DDH's, may need adapting.

## Layers

```
          HTTP request
               |
   +-----------v------------+
   |       Interface        |  controllers, contract types
   +-----------+------------+
               |  Command or Query
   +-----------v------------+
   |      Application       |  services, query handlers, event handlers, ports
   +-----------+------------+
               |
   +-----------v------------+
   |         Domain         |  entities, aggregates, value objects, domain events and errors
   +------------------------+
               ^
               |  implements the ports
   +-----------+------------+
   |     Infrastructure     |  repositories, mappers, Kysely, migrations
   +------------------------+
```

Dependencies point inward. The domain imports no other layer and no framework.
Infrastructure implements ports declared further in, and is reached only through them.

## Request flow

**A command changes state.**

1. The controller maps the validated request to a Command and sends it to the command bus.
2. The service for that use case loads or creates the aggregate through a repository port
   and calls its methods. The domain enforces the rules.
3. The repository writes the aggregate and publishes its domain events, all inside one
   transaction.
4. The service returns a `Result`, and the controller maps it to a response or an error.

**A query only reads.**

1. The controller maps the validated request to a Query and sends it to the query bus.
2. The query handler reads with Kysely and returns a contract type.

Queries skip the domain and the repository on purpose. They cannot break an invariant
because they change nothing, and this product is dominated by search and repeated reads
(ADR 0003), so read paths need direct control over SQL.

## Directory layout

Code is grouped by use case, so that files that change together live together.

```
src/
  main.ts
  app.module.ts
  configs/
  libs/
    api/                    contract error rendering
    auth/                   access token verifier, BearerAuth handler
    application/            request context and its interceptor
    db/                     Kysely provider, transaction manager, migrator, repository base class
    ddd/                    Entity, AggregateRoot, ValueObject, DomainEvent, Command, Query
    exceptions/             base error class and generic errors
    ports/                  ports shared across modules
  modules/
    phenomenon/
      commands/
        create-phenomenon/
          create-phenomenon.http.controller.ts
          create-phenomenon.command.ts
          create-phenomenon.service.ts
      queries/
        find-phenomena/
          find-phenomena.http.controller.ts
          find-phenomena.query-handler.ts
      application/
        event-handlers/
      database/
        phenomenon.repository.port.ts
        phenomenon.repository.ts
      domain/
        phenomenon.entity.ts
        phenomenon.errors.ts
        events/
        value-objects/
      phenomenon.mapper.ts
      phenomenon.di-tokens.ts
      phenomenon.module.ts
    health/
      queries/
        get-health/
database/
  migrations/
tests/
```

`phenomenon` and its use cases are illustrations of the layout. The real modules and use
cases come from `docs/domain.md` and the contract in the system repository, neither of
which defines them yet.

`health` exists because the contract declares it. It is a query slice with no domain.

## Modules

A module is named after a glossary term and acts as a bounded context. Modules stay
independent: one module does not import another's internals. They communicate through
domain events or through a facade the owning module publishes in a `*.public.ts` file.

Add a module for a real boundary in the domain, not for every table.

## Domain layer

- **Entities and aggregates** have identity and protect their invariants. They are created
  through factory methods, expose no public setters, and an aggregate root is the only
  entry point to its aggregate. An aggregate is a transactional unit and references other
  aggregates by id.
- **Value objects** are immutable and compare by value. Use one only for a primitive that
  has real rules. A plain string with no rules stays a string.
- **Domain services** hold logic that spans several entities and belongs to none of them.
- **Guards** enforce invariants and fail fast. Shape validation has already happened at the
  edge by this point, so guards protect business rules, not request formats.
- **Domain errors** are classes with a stable `code` and no HTTP knowledge.

The domain imports neither NestJS nor Kysely, and performs no I/O. An aggregate only
collects its events; publishing them is the repository's job.

Geometry follows RFC 7946: longitude, then latitude. Domain types hold plain GeoJSON
values, and only infrastructure knows about PostGIS column types.

## Application layer

- One service per command use case, registered as its command handler.
- Services orchestrate: they turn input into domain types, load aggregates through ports
  and call their methods. Business rules belong in the domain.
- A service never calls another service, and a command never calls another command. To
  chain work, a command emits an event and a handler issues the next command.
- Declare a port where a real seam exists, such as a repository or a third-party service.
  Depending on a concrete class is fine when nothing would ever replace it.

## Interface layer: the contract at the edge

This API does not define its own interface, so this layer differs most from DDH.

**Types come from the contract package.** Request and response types are aliases of the
types in `@quetzalsoft/phenomena-atlas-contract`. There are no `@nestjs/swagger` decorators
and no generated specification, because a specification derived from the code cannot catch
an unintended change (ADR 0002).

**Validation comes from the pinned OpenAPI document.** `express-openapi-validator` loads the
`openapi.yaml` the contract package exports and validates every request before it reaches a
controller. A route that the contract does not declare answers 404 even if a controller
exists for it. Controllers can assume a well-formed request.

**Bootstrap order matters.** NestJS registers its body parser during initialization, which
is after anything added with `app.use`. With the defaults, the validator sees no body and
rejects every valid request that has one. CORS must also run first, or preflight requests
get a 405. The required order is:

```ts
const app = await NestFactory.create(AppModule, { bodyParser: false });
app.enableCors(corsOptions);
app.use(express.json());
app.use(OpenApiValidator.middleware({ apiSpec, validateRequests: true, validateResponses }));
```

**Responses are built explicitly.** Each controller maps its result to the contract type,
field by field. Never return an entity or a raw database row. This is also what prevents
leaks: the generated schemas do not set `additionalProperties: false`, so neither the
validator nor Schemathesis rejects an extra field in a response.

`validateResponses` is on in tests and off in production. A wrong response should be caught
by the test suite, not turned into a 500 for a user.

**Authentication comes from the contract too.** The contract declares which operations need
a `BearerAuth` token, and the validator calls `bearerAuth` for exactly those. No controller
or guard decides it. The handler checks the token's signature against Keycloak's published
keys, its issuer, its audience (`phenomena-atlas-api`) and its expiry, then sets
`request.principal` to the token's subject. A bad token answers 401 with
`WWW-Authenticate: Bearer`; failing to fetch the keys answers 500, because it is not the
caller's fault.

Keycloak only says who the user is. What the user may do is the API's business: roles and
permissions live in this database, keyed by the token's subject, and are checked in the
API. There is no foreign key to Keycloak and no role claim is read from the token.

**Authorization comes from the contract too.** Every operation that requires a token states
its minimum role with the `x-minimum-role` extension (ADR 0009 in the system repository).
`AuthorizationGuard` in the `account` module runs before every controller: it loads the
caller's account, creating it with the role `user` on the first request and refreshing its
username, name and email from the token when they change, then compares its role with the
operation's minimum. A shortfall answers 403 `forbidden`. A protected operation without a
minimum role is a contract bug and answers 500; a spec checks the pinned contract for it,
so it fails in the test suite first. Controllers that need the caller read
`request.account` through `callerOf`.

**Caching belongs to the read side.** Query controllers set ETag and cache headers, and the
contract declares them.

## Infrastructure layer

- **Repositories** implement a port and map between the aggregate and its persistence
  model through the module's mapper. A database change should not force a domain change.
- **The repository base class** holds the shared write path, and publishes domain events
  inside the transaction.
- **Transactions** are opened by the service through the repository port, as in DDH, which
  delegates to `TransactionManager.run`. The open transaction travels down the call chain in
  Node's `AsyncLocalStorage`, and repositories write through `TransactionManager.connection`,
  which is that transaction or, outside one, the pool. A `run` inside a `run` joins the open
  transaction. The work commits when it resolves and rolls back when it throws, so a service
  that returns an error `Result` must make it roll back too.
- **Kysely** is typed by the `Database` interface in `src/libs/db/database.ts`. A module adds
  its tables there by hand, matching its migration. PostGIS functions go through Kysely's `sql`
  template:

  ```ts
  db.selectFrom('phenomenon')
    .select(['id', sql`ST_AsGeoJSON(geometry)::json`.as('geometry')])
    .where(sql`ST_Intersects(geometry, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326))`)
    .execute();
  ```

- **Migrations** live in `database/migrations/` and run through Kysely's migrator, with
  `bun run migrate` or once per test run. They are named `<UTC timestamp>_<what>.ts`, and
  Kysely refuses one older than the last applied, so rename a branch's migration if a newer
  one merged first. They stay TypeScript and Node loads them as they are, so they may only use
  erasable syntax: no enums, namespaces or parameter properties. Write against
  `Kysely<unknown>`, never the current `Database`, because a migration must keep meaning what
  it meant when it was written. Database identifiers use the glossary's English names.
- **PostGIS is enabled by a migration.** The `postgis/postgis` image installs it on its own,
  so `compose.yaml` and the test setup hide the image's init scripts to start from the same
  empty database a managed service gives. The image is amd64 only, and Docker emulates it
  on Apple silicon.

## Errors

Every failing request returns the contract's `Error` shape: `code`, `message` and optional
`details`. Clients branch on `code`, and because the API is headed for public use, codes
are part of the product.

- **Expected business failures** are returned as a `Result` and matched in the controller,
  which picks the HTTP status for that use case.
- **Unexpected technical failures** are thrown and become a 500 with a generic message.
  Internal detail goes to the logs only.
- **Validator failures** reach the same global exception filter, which renders them as
  `Error`. The filter must copy `error.headers` onto the response, because a 405 needs its
  `Allow` header and the conformance run fails without it.
- **Codes** are stable snake_case, such as `phenomenon_not_found`.

The correlation id is returned in a response header and written to the logs. It is not a
field of `Error`, because the contract does not declare one.

## Events

Domain events are in-process and handled by `@nestjs/event-emitter`, which the repository
base class calls with `emitAsync` so the transaction waits for its handlers.

**Every handler must set `suppressErrors: false`:**

```ts
@OnEvent(PhenomenonCreatedDomainEvent.name, { suppressErrors: false })
```

The default swallows handler errors, so a failing handler would still let the transaction
commit.

Integration events and a transactional outbox are not part of this design. Add them when an
out-of-process consumer exists.

## Testing and conformance

- **Domain unit tests** exercise entities and value objects without booting NestJS.
- **End-to-end specs** call the API over HTTP against a real PostGIS started with
  Testcontainers, and are named by behavior. One container is migrated per run in
  `tests/global-setup.ts`, and specs get its URL with `inject("databaseUrl")`. Response validation is on, so every response
  in this suite is also checked against the contract.
- **Schemathesis** generates requests from the pinned OpenAPI document and runs them against
  the running API with `--checks all`.

Both end-to-end specs and Schemathesis are needed. Schemathesis covers the whole declared
surface but rarely reaches deep paths without test data, and it warns when an operation
keeps returning 404. The end-to-end specs reach those paths, seeding what they need.

Conformance is a blocking check. Like the rest of the test suite, it becomes a required check
on both rulesets once it exists.

## Enforcement

`dependency-cruiser` runs in CI as a blocking check, with DDH's rules plus two more:

| Rule | Forbids |
|---|---|
| `no-domain-to-api-deps` | Domain importing the interface layer |
| `no-domain-to-app-deps` | Domain importing the application layer |
| `no-domain-to-infra-deps` | Domain importing infrastructure, except port files |
| `no-infra-to-api-deps` | Infrastructure importing the interface layer |
| `no-command-query-to-api-deps` | Services, commands and query handlers importing the interface layer |
| `no-domain-to-framework` | Domain importing `@nestjs/*`, `kysely` or `pg` |
| `no-cross-module-internals` | A module importing another module's files, except its `*.public.ts` |

Two things to get right:

- **Stay on TypeScript 6 until `dependency-cruiser` supports 7.** With TypeScript 7 installed,
  it cruises 0 modules and reports no violations, so the check passes while checking nothing.
  The CI step must also fail when it cruises 0 modules.
- **Match directories and suffixes, not bare words.** DDH's bare `domain` pattern also matches
  `*.domain-event-handler.ts`, which lives in the application layer.

## Deviations from DDH

| DDH | Here | Why |
|---|---|---|
| `@nestjs/swagger` and class DTOs | Types from the contract package | ADR 0002: a generated specification cannot catch breaking changes |
| `class-validator` on DTOs | Validation from the OpenAPI document | One source of truth for request shapes |
| Its own error response shape | The contract's `Error` | The contract wins |
| Slonik | Kysely | Query mistakes surface at compile time |
| `oxide.ts` (last release 2022) | `neverthrow` (last release 2025) | More recently maintained |
| Aggregates publish their own events through `EventEmitter2` | Aggregates collect events, repositories publish them | Keeps the framework out of the domain |
| `nestjs-request-context` | Node's `AsyncLocalStorage` | One dependency fewer on NestJS major versions |
| Transaction stored on the request context | Its own `AsyncLocalStorage`, scoped to `run` | Works outside a request, and cannot leak into the next one |
| CLI, message and GraphQL controllers | HTTP only | No such consumer exists, and the slice layout leaves room for one |
| Route versioning such as `v2/users` | Expand/contract with semver | `docs/release.md` in the system repository |
| Gherkin and `jest-cucumber` | End-to-end specs named by behavior | No non-developer reads the specs today |
| NestJS 9 | Current NestJS | Follow the pattern, not the version pins |

## Open decisions

> TODO: the module list. Blocked on `docs/domain.md` in the system repository.

> TODO: hosting and environments. Tracked in `docs/architecture.md` in the system repository.
