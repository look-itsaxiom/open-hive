# Skill Authoring Guide

How to create custom integration skills for Open Hive.

## What Is a Skill?

A skill is a self-contained `SKILL.md` file that teaches Claude Code how to add a specific integration to an Open Hive installation. When a developer points Claude at a skill file, Claude reads the instructions and implements the integration -- creating source files, updating configuration, wiring into the server, writing tests, and verifying the build.

## Skill Structure

Each skill lives in its own directory under `skills/`:

```
skills/
└── add-my-integration/
    └── SKILL.md
```

The `SKILL.md` contains step-by-step instructions that Claude follows to implement the integration.

## Core Ports

Skills plug into one of four core ports defined in the backend:

| Port | Interface | Responsibility |
|------|-----------|----------------|
| **Alerts** | `IAlertSink` | Route collision notifications to the right people |
| **Identity** | `IIdentityProvider` | Authenticate developers and resolve team membership |
| **Storage** | `IHiveStore` | Persist sessions, signals, and collisions |
| **Semantic Analysis** | `ISemanticAnalyzer` | Compare developer intents for overlap (L3b, L3c) |

When writing a skill, identify which port your integration targets and implement the corresponding interface.

## The Rule

If it's about *what Open Hive does*, it belongs in the core. If it's about *how a particular org implements it*, it's a skill.

## Existing Examples

Study these skills as templates:

| Skill | Port | Pattern |
|-------|------|---------|
| [Slack](../../skills/add-slack/) | Alerts | Webhook formatter with Block Kit |
| [PostgreSQL](../../skills/add-postgres/) | Storage | Full `IHiveStore` implementation with migrations |
| [GitHub OAuth](../../skills/add-github-oauth/) | Identity | OAuth flow, org/team discovery, JWT sessions |
| [L3b Embeddings](../../skills/add-embedding-l3b/) | Semantic Analysis | Cosine similarity via embeddings API |

## Key Integration Points

### Notification Skills (Alerts Port)

Implement the `IAlertSink` interface from `@open-hive/shared`:

```typescript
interface IAlertSink {
  readonly name: string;
  shouldFire(event: AlertEvent): boolean;
  deliver(event: AlertEvent): Promise<void>;
}
```

Register your sink with the `AlertDispatcher` via `alertDispatcher.registerSink(yourSink)` in `server.ts`.

### Storage Skills (Storage Port)

Implement the full `IHiveStore` interface (see [ports reference](../reference/ports.md) for the complete method list).

### Auth Skills (Identity Port)

Implement the `IIdentityProvider` interface from `@open-hive/shared`:

```typescript
interface IIdentityProvider {
  readonly name: string;
  readonly requiresAuth: boolean;
  authenticate(ctx: AuthContext): Promise<DeveloperIdentity | null>;
}
```

Replace the default `PassthroughIdentityProvider` in `server.ts`. The `createAuthMiddleware(provider)` in `middleware/auth.ts` delegates to whichever provider is configured. `DeveloperIdentity` is imported from `@open-hive/shared`.

### Semantic Analysis Skills (Semantic Analysis Port)

Implement the `ISemanticAnalyzer` interface from `@open-hive/shared`:

```typescript
interface ISemanticAnalyzer {
  readonly name: string;
  readonly tier: 'L3a' | 'L3b' | 'L3c';
  compare(a: string, b: string): Promise<SemanticMatch | null>;
}
```

Add your analyzer to the `analyzers` array in `server.ts`. The `CollisionEngine` sorts analyzers by tier order (L3a, L3b, L3c) and runs them in order; the first match wins per session pair.

## Skill Checklist

A well-structured skill should instruct Claude to:

1. Create the integration source files
2. Add required environment variables to `env.ts`
3. Wire the integration into `server.ts`
4. Write unit tests
5. Verify the build passes with `npm run build`
6. Update documentation as needed

## Reference

- [Build Your Own skill template](../../skills/build-skill/)
- [Skills catalog](../reference/skills-catalog.md)
- [Port interfaces](../reference/ports.md)
