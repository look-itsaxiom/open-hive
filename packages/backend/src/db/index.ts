import { createSQLiteDB } from './sqlite.js';
import { HiveStore } from './store.js';
import type { HiveBackendConfig } from '@open-hive/shared';

export function createStore(config: HiveBackendConfig): HiveStore {
  if (config.database.type === 'sqlite') {
    const db = createSQLiteDB(config.database.url);
    return new HiveStore(db);
  }
  throw new Error(`Unsupported database type: ${config.database.type}`);
}

export { HiveStore } from './store.js';
