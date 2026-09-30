// Approval API for AI agents.
//   POST /agent  {"service":"web","action":"restart","reason":"...","symptom":"..."}  -> 201 {id,status}
//   POST /agent  {"command":"git push --force origin main","reason":"...","title":"..."}  -> 201 {id,status}
//   GET  /agent?id=<proposal id>                                                     -> {status, detail?, pr?}
// Authorization: Bearer ops_... (created in the app: Settings -> Agent access). The proposal becomes
// an incident card on the owner's phone, marked with the agent's name; nothing runs until they
// approve it with a swipe and biometrics (or decline it).
import { hashToken, parseApproval, parseProposal, proposalStatus } from '../_shared/agents.ts';
import { db, json } from '../_shared/db.ts';
import { notify, type Service, toTarget } from '../_shared/services.ts';
import { actionsFor } from '../_shared/targets.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.serve(async (req) => {
  const token = req.headers.get('Authorization')?.replace(/^Bearer /i, '') ?? '';
  const { data: agent } = token.startsWith('ops_')
    ? await db.from('agent_tokens').select('id, owner, name').eq('token_hash', await hashToken(token)).maybeSingle()
    : { data: null };
  if (!agent) return json(401, { error: 'invalid agent token' });
  await db.from('agent_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', agent.id);

  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!UUID.test(id)) return json(400, { error: 'id required' });
    const { data: inc } = await db.from('incidents').select('id, status, action, context')
      .eq('id', id).eq('owner', agent.owner).maybeSingle();
    if (!inc) return json(404, { error: 'no such proposal' });
    const { data: latest } = await db.from('audit_log').select('outcome, detail').eq('incident_id', id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    return json(200, { id, action: inc.action, ...proposalStatus(inc, latest) });
  }

  if (req.method !== 'POST') return json(405, { error: 'GET or POST' });
  const body = await req.json().catch(() => null);

  // A command the agent wants to run itself: no service, nothing for OpsSwipe to execute.
  if (body && typeof body === 'object' && 'command' in body) {
    const a = parseApproval(body);
    if (typeof a === 'string') return json(400, { error: a });
    const { data: inc } = await db.from('incidents').insert({
      title: a.title,
      owner: agent.owner,
      target_server: agent.name,
      metric: a.command,
      actions: ['approve'],
      action: 'approve',
      reason: a.reason,
      suggested_by: 'agent',
      context: { agent: { name: agent.name }, command: a.command },
    }).select('id').single();
    await notify(agent.owner, {
      title: `${agent.name} asks to run a command`,
      body: a.reason,
      data: { incidentId: inc!.id },
    });
    return json(201, { id: inc!.id, status: 'pending' });
  }

  const { data: services } = await db.from('services').select().eq('owner', agent.owner);
  const byName = new Map(((services ?? []) as Service[]).map((s) => [s.name, s]));
  const p = parseProposal(body, (name) => {
    const s = byName.get(name);
    return s ? actionsFor(toTarget(s)) : null;
  });
  if (typeof p === 'string') return json(400, { error: p });

  const s = byName.get(p.service)!;
  // One open incident per service: an agent can't stack proposals on an ongoing incident.
  const { data: inc, error } = await db.from('incidents').insert({
    title: `${agent.name} proposes a fix`,
    service_id: s.id,
    owner: s.owner,
    target_server: s.name,
    provider: s.provider,
    metric: p.symptom,
    actions: [p.action],
    action: p.action,
    reason: p.reason,
    suggested_by: 'agent',
    context: { agent: { name: agent.name } },
  }).select('id').maybeSingle();
  if (error || !inc) return json(409, { error: `${s.name} already has an open incident; approve or resolve it first` });

  await notify(s.owner, {
    title: `${agent.name} wants to fix ${s.name}`,
    body: p.reason,
    data: { incidentId: inc.id },
  });
  return json(201, { id: inc.id, status: 'pending' });
});
