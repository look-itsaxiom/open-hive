/**
 * Scenario Test: The Mail Nobody Reads (Orphaned Mail)
 *
 * The hive generates collision mail addressed to session IDs. Sessions
 * are ephemeral — they get new IDs every time Claude Code opens.
 * If a developer doesn't read their mail before their session ends,
 * the mail is orphaned: it's addressed to a session ID that will
 * never be used again.
 *
 * This is a confirmed bug: mail is addressed to session_ids, but
 * getUnreadMail() only checks to_session_id. A new session with a
 * different ID can't see mail from the old session.
 *
 * Cast:
 *   Eve  — developer who triggers a collision
 *   Frank — developer who doesn't read his collision mail before session ends
 *
 * Timeline:
 *   Session 1: Eve and Frank both work on payments — collision detected
 *   Session 1: Auto-mail sent to both (addressed to session IDs)
 *   Frank ends session WITHOUT reading mail
 *   Session 2: Frank reopens Claude Code with new session ID
 *   Session 2: Frank checks mail — NOTHING (orphaned)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildScenarioServer, ok } from './test-helpers.js';
import type { HiveStore } from '../db/store.js';

describe('Scenario: The Mail Nobody Reads (Orphaned Mail)', () => {
  let app: FastifyInstance;
  let store: HiveStore;

  before(async () => { ({ app, store } = await buildScenarioServer()); });
  after(async () => { await app.close(); });

  // ─── Setup: Eve and Frank both work on payments ───────────

  describe('Setup: Two developers trigger a collision', () => {

    it('Eve registers and declares intent', async () => {
      await ok(app, 'POST', '/api/sessions/register', {
        session_id: 'eve-session-1',
        developer_email: 'eve@acme.com',
        developer_name: 'Eve',
        repo: 'acme/payments',
        project_path: '/code/payments',
      });

      await ok(app, 'POST', '/api/signals/rich', {
        session_id: 'eve-session-1',
        type: 'intent_declared',
        content: 'Refactoring Stripe payment processing webhook handlers',
      });
    });

    it('Frank registers and declares overlapping intent — collision detected', async () => {
      await ok(app, 'POST', '/api/sessions/register', {
        session_id: 'frank-session-1',
        developer_email: 'frank@acme.com',
        developer_name: 'Frank',
        repo: 'acme/payments',
        project_path: '/code/payments',
      });

      const body = await ok(app, 'POST', '/api/signals/rich', {
        session_id: 'frank-session-1',
        type: 'intent_declared',
        content: 'Updating Stripe webhook handler for payment refund processing',
      });

      assert.ok(
        body.collisions.length >= 1,
        'Should detect semantic collision between Eve and Frank',
      );
    });

    it('Both developers have collision_alert mail', async () => {
      const eveMail = await ok(app, 'GET', '/api/mail/check?session_id=eve-session-1');
      const frankMail = await ok(app, 'GET', '/api/mail/check?session_id=frank-session-1');

      const eveAlert = eveMail.mail.find((m: any) => m.type === 'collision_alert');
      const frankAlert = frankMail.mail.find((m: any) => m.type === 'collision_alert');

      assert.ok(eveAlert, 'Eve should have collision_alert');
      assert.ok(frankAlert, 'Frank should have collision_alert');
    });
  });

  // ─── The Bug: Frank leaves without reading mail ───────────

  describe('Frank ends session without reading mail', () => {

    it('Frank ends his session — mail stays unread', async () => {
      await ok(app, 'POST', '/api/sessions/end', { session_id: 'frank-session-1' });
    });

    it('Mail is still in the database, addressed to frank-session-1', async () => {
      // Direct store query to prove the mail exists
      const mail = await store.getUnreadMail('frank-session-1');
      const alert = mail.find(m => m.type === 'collision_alert');
      assert.ok(alert, 'Collision alert mail still exists in DB for frank-session-1');
      assert.equal(alert!.to_session_id, 'frank-session-1');
      assert.equal(alert!.read_at, null, 'Mail was never read');
    });
  });

  // ─── Session 2: Frank returns with new session ID ─────────

  describe('Frank reopens Claude Code — mail is found via developer_email', () => {

    it('Frank registers a new session and sees his old mail', async () => {
      const body = await ok(app, 'POST', '/api/sessions/register', {
        session_id: 'frank-session-2',
        developer_email: 'frank@acme.com',
        developer_name: 'Frank',
        repo: 'acme/payments',
        project_path: '/code/payments',
      });

      assert.equal(body.ok, true);

      // FIX: Frank's unread_mail from registration now includes mail
      // addressed to his old session, because getUnreadMail also queries
      // by developer_email
      assert.ok(
        body.unread_mail.length >= 1,
        'FIX VERIFIED: Frank sees mail from his old session via developer_email',
      );
      const alert = body.unread_mail.find((m: any) => m.type === 'collision_alert');
      assert.ok(alert, 'Frank sees his collision_alert from the old session');
    });

    it('FIX: Checking mail with new session ID returns old mail via developer_email', async () => {
      const mail = await ok(app, 'GET', '/api/mail/check?session_id=frank-session-2');
      assert.ok(
        mail.mail.length >= 1,
        'FIX VERIFIED: Mail found for frank-session-2 via developer_email lookup',
      );
    });

    it('Mail is reachable via API thanks to to_developer_email column', async () => {
      // The mail exists and is now reachable via the developer_email path
      const mailByEmail = await store.getUnreadMail({ developer_email: 'frank@acme.com' });
      assert.ok(
        mailByEmail.length >= 1,
        'Mail is reachable by querying developer_email directly',
      );
    });
  });

  // ─── The Fix: Verify cross-session mail delivery ──────────

  describe('Cross-session mail delivery works', () => {

    it('Eve sends Frank a coordination message to his old session — Frank still sees it', async () => {
      // Eve tries to coordinate with Frank by sending to his known session ID
      await ok(app, 'POST', '/api/mail/send', {
        from_session_id: 'eve-session-1',
        to_session_id: 'frank-session-1',   // Old session ID, but to_developer_email is populated
        type: 'dependency_notice',
        subject: 'Let\'s sync on payment webhooks',
        content: 'I see we\'re both working on Stripe webhooks. Want to split the work?',
      });

      // Frank CAN see this because mail.ts looks up developer_email from the session
      const frankMail = await ok(app, 'GET', '/api/mail/check?session_id=frank-session-2');
      const coordination = frankMail.mail.find((m: any) => m.type === 'dependency_notice');
      assert.ok(
        coordination,
        'FIX VERIFIED: Eve\'s coordination message is visible to Frank\'s new session',
      );
    });

    it('FIX IMPLEMENTED: Mail is queryable by developer_email (Option A)', async () => {
      // Option A was implemented:
      // - to_developer_email column added to agent_mail table
      // - createMail resolves developer_email from the target session
      // - getUnreadMail accepts { session_id, developer_email } and does OR query
      // - Session registration and mail check both use developer_email

      const frankMail = await store.getUnreadMail({ developer_email: 'frank@acme.com' });
      assert.ok(
        frankMail.length >= 2,
        'Frank has at least 2 unread messages (collision_alert + dependency_notice)',
      );
    });
  });

  // ─── Bonus: context_id mail is NOT orphaned ───────────────

  describe('Bonus: context_id addressed mail survives session changes', () => {

    it('Eve leaves a pheromone trail on the payments context', async () => {
      await ok(app, 'POST', '/api/mail/send', {
        from_session_id: 'eve-session-1',
        to_context_id: 'payments-webhooks',
        type: 'context_share',
        subject: 'Stripe webhook handler research',
        content: 'Key finding: we need idempotency keys for retry handling',
      });
    });

    it('Context-addressed mail is retrievable regardless of session ID', async () => {
      // The mail API supports checking by context_id
      const contextMail = await store.getMailByContext('payments-webhooks');
      assert.ok(contextMail.length >= 1, 'Context-addressed mail survives');
      assert.ok(
        contextMail.some(m => m.subject.includes('Stripe webhook')),
        'Eve\'s pheromone trail is accessible',
      );

      // This is the workaround: use context_id addressing for important
      // cross-session information, and session_id addressing only for
      // real-time alerts during active sessions.
    });
  });
});
