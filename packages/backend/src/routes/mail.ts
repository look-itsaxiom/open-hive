import type { FastifyInstance } from 'fastify';
import type { PortRegistry } from '../port-registry.js';
import type { SendMailRequest, SendMailResponse, CheckMailResponse, AgentMailType } from '@open-hive/shared';

const VALID_MAIL_TYPES: Set<string> = new Set([
  'collision_alert', 'context_share', 'dependency_notice',
  'blocker_notice', 'completion_notice', 'general',
]);

export function mailRoutes(app: FastifyInstance, registry: PortRegistry) {
  const { store, decay } = registry;

  // Send agent mail
  app.post<{ Body: SendMailRequest }>('/api/mail/send', async (req, reply) => {
    try {
      const { from_session_id, to_session_id, to_context_id, type, subject, content } = req.body ?? {};

      if (!type || !subject || !content) {
        return reply.status(400).send({
          ok: false,
          error: 'Missing required fields: type, subject, content',
        });
      }

      if (!VALID_MAIL_TYPES.has(type)) {
        return reply.status(400).send({
          ok: false,
          error: `Invalid mail type: ${type}`,
        });
      }

      if (!to_session_id && !to_context_id) {
        return reply.status(400).send({
          ok: false,
          error: 'Must specify at least one of: to_session_id, to_context_id',
        });
      }

      const mail = await store.createMail({
        from_session_id: from_session_id ?? null,
        to_session_id: to_session_id ?? null,
        to_context_id: to_context_id ?? null,
        type: type as AgentMailType,
        subject,
        content,
        created_at: new Date().toISOString(),
      });

      return { ok: true, mail } satisfies SendMailResponse;
    } catch (err) {
      req.log.error(err, 'Failed to send agent mail');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });

  // Check unread mail for a session
  app.get<{ Querystring: { session_id?: string } }>('/api/mail/check', async (req, reply) => {
    try {
      const { session_id } = req.query;

      if (!session_id) {
        return reply.status(400).send({
          ok: false,
          error: 'Missing required query parameter: session_id',
        });
      }

      // Look up developer_email from the session to also find mail addressed to other sessions by the same developer
      const session = await store.getSession(session_id);
      const developer_email = session?.developer_email;
      const rawMail = await store.getUnreadMail(developer_email
        ? { session_id, developer_email }
        : session_id);
      // Apply decay weights — mail has created_at (not timestamp) so we map
      const mail = rawMail.map(m => ({
        ...m,
        weight: decay.calculateWeight(m.created_at, m.type),
      })).sort((a, b) => b.weight - a.weight);
      return { ok: true, mail } satisfies CheckMailResponse;
    } catch (err) {
      req.log.error(err, 'Failed to check agent mail');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });

  // Mark mail as read
  app.post<{ Body: { mail_id: string } }>('/api/mail/read', async (req, reply) => {
    try {
      const { mail_id } = req.body ?? {};

      if (!mail_id) {
        return reply.status(400).send({
          ok: false,
          error: 'Missing required field: mail_id',
        });
      }

      await store.markMailRead(mail_id);
      return { ok: true };
    } catch (err) {
      req.log.error(err, 'Failed to mark mail as read');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });
}
