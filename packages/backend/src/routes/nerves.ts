import type { FastifyInstance } from 'fastify';
import type { PortRegistry } from '../port-registry.js';
import type { AgentCard, INerveRegistry } from '@open-hive/shared';

export function nerveRoutes(app: FastifyInstance, registry: PortRegistry) {
  // HiveStore implements both IHiveStore and INerveRegistry;
  // PortRegistry will be updated to expose INerveRegistry in Task 3.4.
  const store = registry.store as unknown as INerveRegistry;

  // Register a nerve
  app.post<{ Body: { nerve_type: string; agent_card: AgentCard } }>('/api/nerves/register', async (req, reply) => {
    try {
      const { nerve_type, agent_card } = req.body ?? {};

      if (!nerve_type || !agent_card) {
        return reply.status(400).send({
          ok: false,
          error: 'Missing required fields: nerve_type, agent_card',
        });
      }

      if (!agent_card.agent_id || !agent_card.name || !agent_card.human_client?.email) {
        return reply.status(400).send({
          ok: false,
          error: 'Agent card must include: agent_id, name, human_client.email',
        });
      }

      const nerve = await store.registerNerve(agent_card, nerve_type);
      return { ok: true, nerve };
    } catch (err) {
      req.log.error(err, 'Failed to register nerve');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });

  // List active nerves
  app.get<{ Querystring: { type?: string } }>('/api/nerves/active', async (req, reply) => {
    try {
      const nerves = await store.getActiveNerves(req.query.type);
      return { ok: true, nerves };
    } catch (err) {
      req.log.error(err, 'Failed to list active nerves');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });

  // Nerve heartbeat
  app.post<{ Body: { agent_id: string } }>('/api/nerves/heartbeat', async (req, reply) => {
    try {
      const { agent_id } = req.body ?? {};

      if (!agent_id) {
        return reply.status(400).send({
          ok: false,
          error: 'Missing required field: agent_id',
        });
      }

      const nerve = await store.getNerve(agent_id);
      if (!nerve) {
        return reply.status(404).send({
          ok: false,
          error: `Nerve not found: ${agent_id}`,
        });
      }

      await store.updateLastSeen(agent_id);
      return { ok: true };
    } catch (err) {
      req.log.error(err, 'Failed to process nerve heartbeat');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });

  // Deregister a nerve
  app.post<{ Body: { agent_id: string } }>('/api/nerves/deregister', async (req, reply) => {
    try {
      const { agent_id } = req.body ?? {};

      if (!agent_id) {
        return reply.status(400).send({
          ok: false,
          error: 'Missing required field: agent_id',
        });
      }

      await store.deregisterNerve(agent_id);
      return { ok: true };
    } catch (err) {
      req.log.error(err, 'Failed to deregister nerve');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });
}
