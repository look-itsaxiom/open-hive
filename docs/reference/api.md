# API Reference

Complete API documentation for the Open Hive backend. All endpoints accept and return JSON.

Base URL: `http://localhost:3000` (default)

## Health

### `GET /api/health`

Server health check.

**Response:**
```json
{ "status": "ok", "version": "0.2.0" }
```

---

## Sessions

### `POST /api/sessions/register`

Register a new developer session. Returns active collisions and context about who else is working in the same repo.

**Request body:**
```json
{
  "session_id": "string (required)",
  "developer_email": "string (required)",
  "developer_name": "string (required)",
  "repo": "string (required)",
  "project_path": "string (required)"
}
```

**Response:**
```json
{
  "ok": true,
  "active_collisions": [Collision],
  "active_sessions_in_repo": [
    {
      "session_id": "string",
      "developer_name": "string",
      "intent": "string | null",
      "areas": ["string"]
    }
  ],
  "recent_historical_intents": [
    {
      "developer_name": "string",
      "intent": "string",
      "timestamp": "ISO 8601"
    }
  ]
}
```

Historical intents are deduplicated by session and exclude currently active sessions. They cover the last 48 hours.

### `POST /api/sessions/heartbeat`

Keep a session alive. Sessions without heartbeats are cleaned up after `IDLE_TIMEOUT` seconds.

**Request body:**
```json
{
  "session_id": "string (required)"
}
```

**Response:**
```json
{ "ok": true }
```

**Errors:** `404` if session not found.

### `POST /api/sessions/end`

End a session explicitly.

**Request body:**
```json
{
  "session_id": "string (required)"
}
```

**Response:**
```json
{ "ok": true }
```

**Errors:** `404` if session not found.

### `GET /api/sessions/active`

List active sessions, optionally filtered by repo.

**Query parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `repo` | string | Filter by repository name |
| `team` | string | Filter by team (reserved for future use) |

**Response:**
```json
{
  "sessions": [Session]
}
```

---

## Signals

### `POST /api/signals/intent`

Send developer intent (prompt text). The backend extracts keywords, checks for semantic overlap with other active sessions and historical intents, and returns any detected collisions.

**Request body:**
```json
{
  "session_id": "string (required)",
  "content": "string (required)",
  "type": "prompt | file_modify | file_read | search | explicit (required)"
}
```

**Response:**
```json
{
  "ok": true,
  "collisions": [Collision]
}
```

Collisions include both live session overlaps (L3a) and historical overlaps (within 7 days). The session's `intent` field is updated to the latest content.

### `POST /api/signals/activity`

Record file activity. If type is `file_modify`, triggers L1 (file) and L2 (directory) collision detection.

**Request body:**
```json
{
  "session_id": "string (required)",
  "file_path": "string (required)",
  "type": "file_modify | file_read (required)"
}
```

**Response:**
```json
{
  "ok": true,
  "collisions": [Collision]
}
```

For `file_modify`, the file is added to the session's `files_touched` array and the directory to `areas`. For `file_read`, only `areas` is updated.

**Errors:** `400` if type is not `file_modify` or `file_read`. `404` if session not found.

---

## Collisions

### `GET /api/conflicts/check`

Check a specific file for active conflicts. Also returns nearby sessions working in the same repo.

**Query parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `session_id` | string (required) | Your session ID |
| `file_path` | string (required) | File path to check |
| `repo` | string | Repository name |

**Response:**
```json
{
  "has_conflicts": true,
  "collisions": [Collision],
  "nearby_sessions": [
    {
      "session_id": "string",
      "developer_name": "string",
      "intent": "string | null",
      "files_touched": ["string"]
    }
  ]
}
```

### `POST /api/conflicts/resolve`

Mark a collision as resolved.

**Request body:**
```json
{
  "collision_id": "string (required)",
  "resolved_by": "string (required)"
}
```

**Response:**
```json
{ "ok": true }
```

---

## History

### `GET /api/history`

Query recent signals with optional filters.

**Query parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `file_path` | string | Filter by exact file path |
| `area` | string | Filter by directory prefix |
| `repo` | string | Filter by repository name |
| `since` | string | ISO 8601 timestamp lower bound |
| `limit` | number | Max results (default: 50) |

**Response:**
```json
{
  "signals": [Signal],
  "sessions": [
    {
      "session_id": "string",
      "developer_name": "string",
      "repo": "string",
      "intent": "string | null",
      "started_at": "ISO 8601"
    }
  ]
}
```

Sessions are deduplicated by the signal results -- only sessions referenced by returned signals are included.

---

## Data Models

### Session

```typescript
interface Session {
  session_id: string;
  developer_email: string;
  developer_name: string;
  repo: string;
  project_path: string;
  started_at: string;       // ISO 8601
  last_activity: string;    // ISO 8601
  status: 'active' | 'idle' | 'ended';
  intent: string | null;
  files_touched: string[];
  areas: string[];          // directories being worked in
}
```

### Signal

```typescript
interface Signal {
  signal_id: string;
  session_id: string;
  timestamp: string;
  type: 'prompt' | 'file_modify' | 'file_read' | 'search' | 'explicit';
  content: string;
  file_path: string | null;
  semantic_area: string | null;
}
```

### Collision

```typescript
interface Collision {
  collision_id: string;
  session_ids: string[];
  type: 'file' | 'directory' | 'semantic';
  severity: 'critical' | 'warning' | 'info';
  details: string;
  detected_at: string;
  resolved: boolean;
  resolved_by: string | null;
}
```

### AlertEvent

Sent to registered `IAlertSink` adapters (including generic webhook URLs) when collisions are detected or resolved:

```typescript
interface AlertParticipant {
  developer_name: string;
  developer_email: string;
  repo: string;
  intent: string | null;
}

interface AlertEvent {
  type: 'collision_detected' | 'collision_resolved';
  severity: 'critical' | 'warning' | 'info';
  collision: Collision;
  participants: AlertParticipant[];
  timestamp: string;
}
```
