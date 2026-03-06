import type {
  IHiveStore, IIdentityProvider, ISemanticAnalyzer,
  AlertEvent, AlertParticipant, Collision,
} from '@open-hive/shared';
import type { AlertDispatcher } from './services/alert-dispatcher.js';

/**
 * Central wiring point for all port implementations.
 * Created once at startup; passed to routes and middleware.
 */
export interface PortRegistry {
  store: IHiveStore;
  identity: IIdentityProvider;
  analyzers: ISemanticAnalyzer[];
  alerts: AlertDispatcher;
}

/**
 * Build an AlertEvent from a collision by looking up participant sessions.
 * Eliminates the repeated "fetch sessions → map to AlertParticipant" pattern in routes.
 */
export async function buildAlertEvent(
  store: IHiveStore,
  type: AlertEvent['type'],
  collision: Collision,
): Promise<AlertEvent> {
  const sessionData = await Promise.all(
    collision.session_ids.map(id => store.getSession(id))
  );

  const participants: AlertParticipant[] = sessionData
    .filter(Boolean)
    .map(s => ({
      developer_name: s!.developer_name,
      developer_email: s!.developer_email,
      repo: s!.repo,
      intent: s!.intent,
    }));

  return {
    type,
    severity: collision.severity,
    collision,
    participants,
    timestamp: new Date().toISOString(),
  };
}
