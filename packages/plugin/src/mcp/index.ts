import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadClientConfig } from '../config/config.js';
import { HiveClient } from '../client/hive-client.js';
import { createHiveMcpServer } from './server.js';

const config = loadClientConfig();
if (!config || !config.backend_url) {
  console.error('Open Hive not configured. Run /hive setup first.');
  process.exit(1);
}

const client = new HiveClient(config.backend_url);
const server = createHiveMcpServer(client, config.identity);
const transport = new StdioServerTransport();
await server.connect(transport);
