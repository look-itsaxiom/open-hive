# Plugin Usage

The Open Hive plugin for Claude Code passively tracks your development activity and alerts you to collisions with teammates.

## Installation

```bash
claude plugin install open-hive
```

Then run `/hive setup` in any Claude Code session to configure your backend URL and identity.

## How It Works

The plugin registers six hooks that run automatically during your Claude Code session:

| Hook | When | What It Does |
|------|------|--------------|
| `SessionStart` | Session opens | Registers you with the backend, receives active collision state |
| `UserPromptSubmit` | Every prompt | Captures your intent, checks for semantic overlap with teammates |
| `PreToolUse` | Before Write/Edit | Checks if someone else is modifying the same file |
| `PostToolUse` | After Write/Edit | Records which files you touched |
| `PreCompact` | Before context compaction | Injects active session awareness into compressed context |
| `SessionEnd` | Session closes | Deregisters your session |

### Design Principle

Hooks never block. All backend calls have 3-second timeouts and gracefully fall through if the backend is unreachable. If the backend is down, your dev experience is unchanged.

## Commands

| Command | Description |
|---------|-------------|
| `/hive setup` | Configure backend URL and identity |
| `/hive status` | Show your active session and any collisions |
| `/hive who` | List all active developers and what they're working on |
| `/hive history` | View recent activity signals for the current repo |

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

- `[Open Hive !!!]` -- critical (L1 file collision)
- `[Open Hive !!]` -- warning (L2 directory collision or historical overlap)
- `[Open Hive !]` -- info (L3a semantic overlap)

## Session Awareness

On session start, the plugin displays:
- Active sessions in the same repo (who is working on what)
- Recent historical intents from the last 48 hours (what was recently worked on)
- Any active collisions involving your session

Before context compaction (`PreCompact`), the plugin injects active session information so awareness persists across compacted context.
