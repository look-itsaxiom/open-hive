# Plugin Usage

The Open Hive plugin for Claude Code passively tracks your development activity, coordinates with teammates, and maintains context between sessions.

## Installation

```bash
claude plugin install open-hive
```

Then run `/hive setup` in any Claude Code session to configure your backend URL and identity.

## How It Works

The plugin registers seven hooks that run automatically during your Claude Code session:

| Hook | When | What It Does |
|------|------|--------------|
| `SessionStart` | Session opens | Registers with backend, loads nerve state, shows active teammates + unread mail |
| `UserPromptSubmit` | Every prompt | Captures your intent, checks for semantic overlap, persists to nerve state |
| `PreToolUse` | Before Write/Edit | Checks if someone else is modifying the same file |
| `PostToolUse` | After Write/Edit | Records which files you touched, updates nerve state |
| `Stop` | Agent stops | Checkpoints nerve state to disk (crash protection) |
| `SessionEnd` | Session closes | Snapshots session to nerve state, deregisters from backend |
| `PreCompact` | Before context compaction | Injects active session awareness into compressed context |

### Design Principles

- **Hooks never block.** All backend calls have timeouts and gracefully fall through if the backend is unreachable.
- **Each hook is a separate process.** The nerve state persists to disk on every hook so data accumulates across invocations.
- **Crash recovery is automatic.** If Claude Code crashes, the next session start auto-snapshots the stale session as "interrupted."

## Commands

| Command | Description |
|---------|-------------|
| `/hive setup` | Configure backend URL and identity |
| `/hive status` | Show your active session and any collisions |
| `/hive who` | List all active developers and what they're working on |
| `/hive history` | View recent activity signals for the current repo |

## Nerve State

The plugin maintains a local JSON file at `~/.open-hive/nerve-state.json` that gives it memory between sessions. This is the nerve's personal knowledge of its developer.

**What the nerve remembers:**
- Last session (repo, intent, files touched, outcome)
- Active blockers and unresolved collisions
- Unread mail context
- Frequently worked areas (accumulated over many sessions)
- Repos the developer has been active in

On session start, the plugin sends this context to the hive along with the registration, making check-in responses richer and more relevant.

**The hive knows the org. The nerve knows its human.**

## Client Configuration

The plugin stores its configuration in `~/.open-hive.yaml`:

```yaml
backend_url: https://hive.internal.company.com
identity:
  email: developer@company.com
  display_name: Developer Name
team: engineering
notifications:
  inline: true
  webhook_url: null
```

See [config reference](../reference/config.md) for all client config options.

## Alert Format

When a collision is detected, the plugin injects a system message into your Claude Code session:

- `[Open Hive !!!]` — critical (L1 file collision)
- `[Open Hive !!]` — warning (L2 directory collision or historical overlap)
- `[Open Hive !]` — info (L3a semantic overlap)

## Session Awareness

On session start, the plugin displays:
- Active sessions in the same repo (who is working on what)
- Recent historical intents from the last 48 hours
- Any active collisions involving your session
- Unread agent mail (collision alerts, coordination messages, pheromone trails)
- Last session context from nerve state (what you were doing before)

Before context compaction (`PreCompact`), the plugin injects active session information so teammate awareness persists across compacted context.

## Agent Mail

The hive automatically generates `collision_alert` mail when overlapping work is detected. Developers can also send coordination messages to each other through the API. Mail is addressed by developer email, so it survives across session restarts — you won't miss messages because you closed and reopened Claude Code.

Context-addressed mail ("pheromone trails") lets developers leave notes for anyone working on a particular area, even if they don't know who that will be.
