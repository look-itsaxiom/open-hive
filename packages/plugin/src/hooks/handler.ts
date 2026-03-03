import { HiveClient } from '../client/hive-client.js';
import { loadClientConfig } from '../config/config.js';
import { basename } from 'node:path';
import type { Collision } from '@open-hive/shared';

const config = loadClientConfig();
const client = config?.backend_url ? new HiveClient(config.backend_url) : null;

interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  prompt?: string;
  user_prompt?: string;
  [key: string]: unknown;
}

function getSessionId(input: HookInput): string {
  return input.session_id ?? 'unknown';
}

function getRepo(input: HookInput): string {
  return basename(input.cwd ?? process.cwd());
}

function formatCollisions(collisions: Collision[]): string {
  if (collisions.length === 0) return '';
  return collisions.map(c => {
    const icon = c.severity === 'critical' ? '!!!' : c.severity === 'warning' ? '!!' : '!';
    return `[Open Hive ${icon}] ${c.details}`;
  }).join('\n');
}

async function handleSessionStart(input: HookInput): Promise<Record<string, unknown>> {
  if (!client || !config) return {};
  const session_id = getSessionId(input);
  const repo = getRepo(input);

  const result = await client.registerSession({
    session_id,
    developer_email: config.identity.email,
    developer_name: config.identity.display_name,
    repo,
    project_path: input.cwd ?? process.cwd(),
  });

  if (!result) return {};

  const messages: string[] = [];
  if (result.active_sessions_in_repo.length > 0) {
    messages.push('Open Hive: Active sessions in this repo:');
    for (const s of result.active_sessions_in_repo) {
      messages.push(`  - ${s.developer_name}: ${s.intent ?? 'no intent declared'} (areas: ${s.areas.join(', ') || 'none yet'})`);
    }
  }
  if (result.active_collisions.length > 0) {
    messages.push(formatCollisions(result.active_collisions));
  }

  return messages.length > 0 ? { systemMessage: messages.join('\n') } : {};
}

async function handleUserPromptSubmit(input: HookInput): Promise<Record<string, unknown>> {
  if (!client) return {};
  const session_id = getSessionId(input);
  const prompt = input.prompt ?? input.user_prompt ?? '';
  if (!prompt) return {};

  const result = await client.sendIntent({
    session_id,
    content: prompt,
    type: 'prompt',
  });

  if (!result || result.collisions.length === 0) return {};
  return { systemMessage: formatCollisions(result.collisions) };
}

async function handlePreToolUse(input: HookInput): Promise<Record<string, unknown>> {
  if (!client) return {};
  const toolName = input.tool_name ?? '';
  if (!['Write', 'Edit'].includes(toolName)) return {};

  const filePath = input.tool_input?.file_path as string | undefined;
  if (!filePath) return {};

  const session_id = getSessionId(input);
  const repo = getRepo(input);

  const result = await client.checkConflicts(session_id, filePath, repo);
  if (!result || !result.has_conflicts) return {};

  return { systemMessage: formatCollisions(result.collisions) };
}

async function handlePostToolUse(input: HookInput): Promise<Record<string, unknown>> {
  if (!client) return {};
  const toolName = input.tool_name ?? '';
  if (!['Write', 'Edit'].includes(toolName)) return {};

  const filePath = input.tool_input?.file_path as string | undefined;
  if (!filePath) return {};

  const session_id = getSessionId(input);
  await client.sendActivity({
    session_id,
    file_path: filePath,
    type: 'file_modify',
  });

  return {};
}

async function handleSessionEnd(input: HookInput): Promise<Record<string, unknown>> {
  if (!client) return {};
  await client.endSession({ session_id: getSessionId(input) });
  return {};
}

async function handlePreCompact(input: HookInput): Promise<Record<string, unknown>> {
  if (!client) return {};
  const repo = getRepo(input);
  const result = await client.listActive(repo);
  if (!result || result.sessions.length === 0) return {};
  const session_id = getSessionId(input);
  const others = result.sessions.filter(s => s.session_id !== session_id);
  if (others.length === 0) return {};
  const lines = others.map(s =>
    `- ${s.developer_name}: ${s.intent ?? 'no intent'} (areas: ${s.areas?.join(', ') || 'none'})`
  );
  return {
    systemMessage: `Open Hive: Active sessions in this repo (preserve across compaction):\n${lines.join('\n')}`,
  };
}

// Main: read stdin, route to handler, write stdout
async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  const event = input.hook_event_name ?? '';
  let result: Record<string, unknown> = {};

  switch (event) {
    case 'SessionStart':
      result = await handleSessionStart(input);
      break;
    case 'UserPromptSubmit':
      result = await handleUserPromptSubmit(input);
      break;
    case 'PreToolUse':
      result = await handlePreToolUse(input);
      break;
    case 'PostToolUse':
      result = await handlePostToolUse(input);
      break;
    case 'SessionEnd':
      result = await handleSessionEnd(input);
      break;
    case 'PreCompact':
      result = await handlePreCompact(input);
      break;
    default:
      break;
  }

  if (Object.keys(result).length > 0) {
    process.stdout.write(JSON.stringify(result));
  }
}

main().catch(() => process.exit(0));
