---
name: admin-status
description: Show Open Hive backend configuration — installed skills, port implementations, and health
allowed-tools: ["Read", "Bash", "Glob", "Grep"]
---

Show the current configuration state of the Open Hive backend.

## Process

### 1. Detect installed integrations

Read `packages/backend/src/server.ts` and check which non-default implementations are wired:

- **Store:** Look for imports other than `HiveStore` / `createSQLiteDB`. If `PostgresStore` is imported, report "PostgreSQL". Otherwise "SQLite (default)".
- **Identity:** Look for imports other than `PassthroughIdentityProvider`. If an OAuth provider is imported, report its name. Otherwise "Passthrough (no auth)".
- **Analyzers:** Look for imports other than `KeywordAnalyzer`. Report each registered analyzer (e.g., "KeywordAnalyzer (L3a)", "EmbeddingAnalyzer (L3b)", "LLMAnalyzer (L3c)").
- **Alert sinks:** Look for imports other than `GenericWebhookSink`. Report each registered sink (e.g., "SlackAlertSink", "TeamsAlertSink").
- **Decay:** Always present (core service). Report half-life from env config.

### 2. Check environment

Read `packages/backend/.env` (if it exists) and report configured values:
- PORT
- DB_TYPE / DATABASE_URL
- ALERT_WEBHOOK_URLS (how many configured)
- AUTH_ENABLED
- SEMANTIC_EMBEDDINGS / SEMANTIC_LLM
- DECAY_HALF_LIFE_HOURS

### 3. Check backend health (if running)

Try to call the health endpoint:
```bash
curl -s http://localhost:${PORT:-3333}/api/health
```

If reachable, report:
- Status: running / unreachable
- Version
- Active nerves count

### 4. Present summary

Format as a clean status report:

```
Open Hive Backend Status
========================
Health:     running (v0.3.0) | 3 active nerves
Store:      SQLite (default)
Identity:   Passthrough (no auth)
Analyzers:  KeywordAnalyzer (L3a)
Alerts:     GenericWebhookSink (1 URL configured)
Decay:      24h half-life

Installed Skills: none
Available Skills: 12 (run /hive-admin list to see them)
```
