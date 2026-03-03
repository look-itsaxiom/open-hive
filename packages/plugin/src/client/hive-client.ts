import type {
  RegisterSessionRequest, RegisterSessionResponse,
  IntentSignalRequest, IntentSignalResponse,
  ActivitySignalRequest, ActivitySignalResponse,
  CheckConflictsResponse,
  EndSessionRequest,
  ListActiveResponse,
} from '@open-hive/shared';

export class HiveClient {
  constructor(private baseUrl: string) {}

  async registerSession(req: RegisterSessionRequest): Promise<RegisterSessionResponse | null> {
    return this.post('/api/sessions/register', req);
  }

  async endSession(req: EndSessionRequest): Promise<void> {
    await this.post('/api/sessions/end', req);
  }

  async sendIntent(req: IntentSignalRequest): Promise<IntentSignalResponse | null> {
    return this.post('/api/signals/intent', req);
  }

  async sendActivity(req: ActivitySignalRequest): Promise<ActivitySignalResponse | null> {
    return this.post('/api/signals/activity', req);
  }

  async checkConflicts(session_id: string, file_path: string, repo?: string): Promise<CheckConflictsResponse | null> {
    const params = new URLSearchParams({ session_id, file_path });
    if (repo) params.set('repo', repo);
    return this.get(`/api/conflicts/check?${params}`);
  }

  async listActive(repo?: string): Promise<ListActiveResponse | null> {
    const params = repo ? `?repo=${encodeURIComponent(repo)}` : '';
    return this.get(`/api/sessions/active${params}`);
  }

  async heartbeat(session_id: string): Promise<void> {
    await this.post('/api/sessions/heartbeat', { session_id });
  }

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    } catch {
      return null; // Backend unreachable — never block the developer
    }
  }

  private async get<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    } catch {
      return null;
    }
  }
}
