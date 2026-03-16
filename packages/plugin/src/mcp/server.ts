import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { HiveClient } from '../client/hive-client.js';
import type { AgentMailType } from '@open-hive/shared';

export function createHiveMcpServer(client: HiveClient, identity: { email: string; display_name: string }): McpServer {
  const server = new McpServer({
    name: 'open-hive',
    version: '0.3.0',
  });

  // ─── hive_check_conflicts ──────────────────────────────────
  server.tool(
    'hive_check_conflicts',
    'Check if a file has active conflicts with other developers',
    {
      session_id: z.string().describe('Your current session ID'),
      file_path: z.string().describe('File path to check'),
      repo: z.string().optional().describe('Repository name'),
    },
    async ({ session_id, file_path, repo }) => {
      const result = await client.checkConflicts(session_id, file_path, repo);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result ?? { collisions: [] }, null, 2) }],
      };
    },
  );

  // ─── hive_list_active ──────────────────────────────────────
  server.tool(
    'hive_list_active',
    'List all active developer sessions',
    {
      repo: z.string().optional().describe('Filter by repository'),
    },
    async ({ repo }) => {
      const result = await client.listActive(repo);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result ?? { sessions: [] }, null, 2) }],
      };
    },
  );

  // ─── hive_broadcast_intent ─────────────────────────────────
  server.tool(
    'hive_broadcast_intent',
    'Declare what you plan to work on so others know',
    {
      session_id: z.string().describe('Your current session ID'),
      intent: z.string().describe('What you plan to work on'),
      repo: z.string().optional().describe('Repository name'),
    },
    async ({ session_id, intent, repo }) => {
      const result = await client.sendIntent({
        session_id,
        content: intent,
        type: 'intent_declared',
      });
      return {
        content: [{ type: 'text' as const, text: result ? `Intent broadcast: "${intent}"` : 'Failed to broadcast intent' }],
      };
    },
  );

  // ─── hive_get_history ──────────────────────────────────────
  server.tool(
    'hive_get_history',
    'Get recent activity signals for a repository',
    {
      repo: z.string().describe('Repository name'),
      limit: z.number().optional().describe('Max results (default 50)'),
    },
    async ({ repo, limit }) => {
      const result = await client.getHistory(repo, limit);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result ?? { signals: [] }, null, 2) }],
      };
    },
  );

  // ─── hive_resolve_collision ────────────────────────────────
  server.tool(
    'hive_resolve_collision',
    'Mark a collision as resolved',
    {
      collision_id: z.string().describe('The collision ID to resolve'),
    },
    async ({ collision_id }) => {
      const resolved = await client.resolveCollision(collision_id, identity.email);
      return {
        content: [{ type: 'text' as const, text: resolved ? `Collision ${collision_id} resolved` : `Failed to resolve collision ${collision_id}` }],
      };
    },
  );

  // ─── hive_who ──────────────────────────────────────────────
  server.tool(
    'hive_who',
    'Human-readable summary of who is working on what right now',
    {
      repo: z.string().optional().describe('Filter by repository'),
    },
    async ({ repo }) => {
      const result = await client.listActive(repo);
      if (!result || result.sessions.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No active sessions right now.' }] };
      }
      const lines = result.sessions.map(s => {
        const intent = s.intent ? ` — "${s.intent}"` : '';
        const files = s.files_touched.length > 0 ? ` (${s.files_touched.length} files)` : '';
        return `• ${s.developer_name} (${s.developer_email}) in ${s.repo}${intent}${files}`;
      });
      return {
        content: [{ type: 'text' as const, text: `Active developers:\n${lines.join('\n')}` }],
      };
    },
  );

  // ─── hive_check_mail ───────────────────────────────────────
  server.tool(
    'hive_check_mail',
    'Check for unread agent mail addressed to you',
    {
      session_id: z.string().describe('Your current session ID'),
    },
    async ({ session_id }) => {
      const result = await client.checkMail(session_id);
      if (!result || result.mail.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No unread mail.' }] };
      }
      const lines = result.mail.map(m =>
        `• [${m.type}] ${m.subject} — from ${m.from_session_id ?? 'system'} (${m.created_at})`,
      );
      return {
        content: [{ type: 'text' as const, text: `Unread mail (${result.mail.length}):\n${lines.join('\n')}` }],
      };
    },
  );

  // ─── hive_send_mail ────────────────────────────────────────
  server.tool(
    'hive_send_mail',
    'Send mail to another developer or context',
    {
      from_session_id: z.string().describe('Your session ID'),
      to_session_id: z.string().optional().describe('Target session ID'),
      to_context_id: z.string().optional().describe('Target workstream/context ID'),
      type: z.enum(['collision_alert', 'context_share', 'dependency_notice', 'blocker_notice', 'completion_notice']).describe('Mail type'),
      subject: z.string().describe('Brief subject line'),
      content: z.string().describe('Mail body'),
    },
    async ({ from_session_id, to_session_id, to_context_id, type, subject, content }) => {
      const result = await client.sendMail({
        from_session_id,
        to_session_id,
        to_context_id,
        type,
        subject,
        content,
      });
      return {
        content: [{ type: 'text' as const, text: result ? `Mail sent: "${subject}"` : 'Failed to send mail' }],
      };
    },
  );

  // ─── hive_list_nerves ──────────────────────────────────────
  server.tool(
    'hive_list_nerves',
    'List connected nerves (Claude Code plugin instances)',
    {
      nerve_type: z.string().optional().describe('Filter by nerve type'),
    },
    async ({ nerve_type }) => {
      const result = await client.listNerves(nerve_type);
      if (!result || result.nerves.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No active nerves.' }] };
      }
      const lines = result.nerves.map(n =>
        `• ${n.nerve_id} (${n.nerve_type}) — created ${n.created_at}`,
      );
      return {
        content: [{ type: 'text' as const, text: `Active nerves (${result.nerves.length}):\n${lines.join('\n')}` }],
      };
    },
  );

  return server;
}
