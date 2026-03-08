# Nerve State Persistence Layer — Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the open-hive Claude Code plugin persistent memory between sessions so it can send richer signals to the hive on check-in.

**Architecture:** A `NerveState` class manages a JSON file at `~/.open-hive/nerve-state.json`. The hook handler loads it on SessionStart, mutates it during the session via method calls, and saves on Stop/SessionEnd. The hive-client reads from NerveState to compose enriched registration payloads.

**Tech Stack:** TypeScript, Node.js fs (readFileSync/writeFileSync), JSON, existing plugin hook infrastructure.

---

## Core Principle

**The hive knows the org. The nerve knows its human.**

The nerve state is the plugin's personal memory of its developer — what they were working on, what's blocking them, what areas they frequent across all repos. This makes every hive check-in richer without duplicating the hive's organizational state.

## File Location

`~/.open-hive/nerve-state.json` — single global file per developer, not per-repo.

## Schema

```typescript
interface NerveStateData {
  /** Snapshot of the most recent completed session */
  last_session: {
    id: string;
    repo: string;
    ended_at: string;           // ISO 8601
    intent: string | null;
    files_touched: string[];
    areas: string[];
    outcome: 'completed' | 'interrupted' | null;
  } | null;

  /** Context that carries forward between sessions */
  carry_forward: {
    blockers: Array<{
      text: string;
      since: string;            // ISO 8601
    }>;
    unresolved_collisions: Array<{
      collision_id: string;
      with_developer: string;
      area: string;
      detected_at: string;      // ISO 8601
    }>;
    pending_mail_context: Array<{
      from: string;
      subject: string;
      received_at: string;      // ISO 8601
    }>;
  };

  /** Long-term memory — accumulated over many sessions */
  profile: {
    areas: Array<{
      path: string;
      session_count: number;
      last_active: string;      // ISO 8601
    }>;
    repos: Array<{
      name: string;
      session_count: number;
      last_active: string;      // ISO 8601
    }>;
  };
}
```

## NerveState Class

Located at `packages/plugin/src/nerve/nerve-state.ts`.

```
NerveState
├── load()                              — read file, return defaults if missing
├── save()                              — atomic write (tmp + rename)
├── recordSessionStart(id, repo, path)  — bump repo/area counts, set current session
├── recordIntent(content)               — update current intent
├── recordFileTouch(filePath)           — add to files_touched, update area counts
├── recordSessionEnd(outcome?)          — snapshot to last_session, save
├── recordCollision(collision)          — add to carry_forward
├── recordMailReceived(mail)            — add to carry_forward
├── clearResolvedCollision(id)          — remove from carry_forward
├── getCheckInContext()                 — compose rich payload for hive registration
└── state: NerveStateData              — in-memory object
```

**Separation of concerns:**
- `NerveState` owns local file persistence. No network calls.
- `HiveClient` owns backend communication. Reads from NerveState for enriched payloads.
- `handler.ts` orchestrates: load state → call hooks → mutate state → save state.

## Hook Integration

| Hook | What it does with NerveState |
|---|---|
| **SessionStart** (`startup`) | `load()`, `recordSessionStart()`, use `getCheckInContext()` to enrich registration |
| **SessionStart** (`resume`) | `load()` only (re-orient after compaction) |
| **UserPromptSubmit** | `recordIntent(prompt)` |
| **PostToolUse** (`Write\|Edit`) | `recordFileTouch(filePath)` — already sends to backend, now also local |
| **Stop** | `save()` — checkpoint in case of crash |
| **SessionEnd** | `recordSessionEnd()`, `save()` — final snapshot |

## Enriched Check-In

Today's registration payload:
```json
{ "session_id": "x", "developer_email": "alice@acme.com", "developer_name": "Alice", "repo": "platform", "project_path": "/code/platform" }
```

With nerve state, the plugin can send additional context via a new field or system message:
```json
{
  "session_id": "x",
  "developer_email": "alice@acme.com",
  "developer_name": "Alice",
  "repo": "platform",
  "project_path": "/code/platform",
  "nerve_context": {
    "last_session": {
      "repo": "platform",
      "intent": "Implementing OAuth2 PKCE flow",
      "ended_at": "2026-03-07T22:30:00Z",
      "outcome": null
    },
    "active_blockers": ["Waiting on Charlie's PRD edits"],
    "unresolved_collisions": ["col-xyz"],
    "frequent_areas": ["src/auth/", "src/middleware/"],
    "repos_active_in": ["platform", "docs"]
  }
}
```

The backend can use `nerve_context` to return more relevant results — or ignore it if it doesn't understand it yet (backwards compatible).

## Profile Accumulation

The `profile` section grows over time:
- Every SessionStart bumps the `session_count` for the current repo
- Every file touch updates the area's `last_active` and increments `session_count` (once per session per area, not per file)
- Areas and repos are capped at 50 entries each, oldest pruned when full
- No decay on the profile — it's a frequency counter, not a signal. The hive applies decay on its end.

## Failure Handling

- If `~/.open-hive/` doesn't exist, create it on first save
- If `nerve-state.json` is corrupted/unparseable, start from defaults (don't crash)
- If save fails (disk full, permissions), log warning, continue (never block the developer)
- Atomic write: write to `.nerve-state.json.tmp`, rename to `nerve-state.json`

## What This Does NOT Do

- No network calls — that's HiveClient's job
- No decay — the hive handles signal decay
- No org awareness — the nerve only knows its human
- No state from other developers — purely personal memory
- No sensitive data — no secrets, tokens, or credentials. File paths and intent text only.
