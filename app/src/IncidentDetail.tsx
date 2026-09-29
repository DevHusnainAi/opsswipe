// One incident in full: what failed, the likely cause, the suggested fix and who decided it, what the
// AI said (agreeing, disagreeing, or unavailable), the timeline, and the code fix with its proof.
// Everything shown is what OpsSwipe recorded; nothing is re-asked or re-computed here.
import { ArrowSquareOut, X } from 'phosphor-react-native';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { connect, type AuditEntry, type Incident } from './api';
import { fixFor } from './fixes';
import { useEffect, useState, type ReactNode } from 'react';
import { atRisk, formatDuration, lostLine, recoveryLine } from './format';
import { PROVIDER } from './SwipeCard';
import { TARGET, c, radius, space, type } from './theme';
import { Chip } from './ui';

type PrFile = { file: string; status: string; additions: number; deletions: number; patch: string };

const clock = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const shortSha = (sha?: string) => (sha ? sha.slice(0, 7) : null);

// What the AI's answer means to a reader.
function aiNote(ctx: Incident['context'], decided: string) {
  const ai = ctx?.ai;
  if (!ai) return null;
  if ('error' in ai) return { tone: c.muted, title: 'AI second opinion unavailable', body: ai.error };
  if (ai.agreed) return { tone: c.green, title: `AI agreed: ${fixFor(ai.action).label}`, body: ai.reason };
  return {
    tone: c.amber,
    title: `AI suggested ${fixFor(ai.action).label} instead`,
    body: `${ai.reason}${ai.reason ? '\n\n' : ''}The card keeps ${fixFor(decided).label}: the rules decide which fix is suggested, and the AI's view is shown here so you can choose it yourself.`,
  };
}

export function IncidentDetail(
  { incident: i, audit, onClose }: { incident: Incident; audit: AuditEntry[]; onClose: () => void },
) {
  const ctx = i.context ?? {};
  const steps = audit.filter((a) => a.incident_id === i.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const live = ctx.live?.commit;
  const note = aiNote(ctx, i.action);
  const proof = ctx.proof && ctx.pr && ctx.proof.headSha === ctx.pr.headSha ? ctx.proof : null;
  const cost = atRisk(i);
  // The PR's diff, read here before swiping Merge (the swipe and fingerprint are the review).
  const [diff, setDiff] = useState<PrFile[] | string | null>(null);
  const prNumber = ctx.pr?.number;
  useEffect(() => {
    if (!prNumber) return;
    connect<{ files: PrFile[] }>('pr_diff', { incidentId: i.id }).then((r) => setDiff(r.files), (e) => setDiff(String(e.message ?? e)));
  }, [i.id, prNumber]);
  // Written once by the server after the incident resolves, then kept on the incident.
  const [pm, setPm] = useState<{ why: string; prevent: string[] } | string | null>(null);
  // Only real outages get a postmortem: not a false alarm, a declined proposal or an agent's own command.
  const resolved = i.status === 'resolved' && !!i.provider && !ctx.self_healed && !ctx.dismissed && !ctx.declined;
  useEffect(() => {
    if (!resolved) return;
    connect<{ postmortem: { why: string; prevent: string[] } }>('postmortem', { incidentId: i.id })
      .then((r) => setPm(r.postmortem), (e) => setPm(String(e.message ?? e)));
  }, [i.id, resolved]);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.title} accessibilityRole="header">{i.title}</Text>
            <Text style={type.monoCaption}>{i.target_server} · {PROVIDER[i.provider ?? ''] ?? 'Server'}</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.icon}>
            <X size={22} color={c.text} weight="bold" />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.meta}>
            <Chip label={i.severity} color={i.severity === 'CRITICAL' ? c.red : c.amber} tint={i.severity === 'CRITICAL' ? c.redTint : c.amberTint} />
            <Chip label={i.status === 'resolved' ? 'Resolved' : 'Open'} />
            {cost && <Chip label={cost} color={c.amber} tint={c.amberTint} />}
          </View>

          <Block title="What happened">
            <Text style={type.mono}>{i.metric}</Text>
            <Text style={type.caption}>First seen {clock(i.created_at)}</Text>
            {(ctx.replay ?? []).length > 0 && (
              <View style={styles.list}>
                <Text style={type.label}>Failing requests ({ctx.replay!.length}), replayed in CI before any code fix merges</Text>
                {ctx.replay!.map((s, n) => (
                  <Text key={n} style={type.monoCaption}>{s.method} {s.path} → {s.status}</Text>
                ))}
              </View>
            )}
          </Block>

          <Block title="Likely cause">
            {live ? (
              <Text style={type.body}>
                Running release <Text style={type.mono}>{shortSha(live.id)}</Text>
                {live.message ? `: ${live.message.split('\n')[0]}` : ''}
              </Text>
            ) : (
              <Text style={type.caption}>No deploy information for this service; the reason below is based on the symptom.</Text>
            )}
            {i.reason && <Text style={type.body}>{i.reason}</Text>}
          </Block>

          <Block title="Suggested fix">
            <View style={styles.row}>
              <Text style={[type.body, { flex: 1 }]}>{fixFor(i.action).label}</Text>
              <Chip label={i.suggested_by === 'agent' ? (ctx.agent?.name ?? 'AI agent') : i.suggested_by === 'ai' ? 'Rules + AI' : 'Rules'} />
            </View>
            {i.actions.length > 1 && (
              <Text style={type.caption}>Also available: {i.actions.filter((a) => a !== i.action).map((a) => fixFor(a).label).join(', ')}</Text>
            )}
          </Block>

          {note && (
            <Block title="AI second opinion">
              <Text style={[type.label, { color: note.tone }]}>{note.title}</Text>
              {!!note.body && <Text style={type.body}>{note.body}</Text>}
            </Block>
          )}

          {ctx.pr && (
            <Block title="Code fix">
              <Pressable onPress={() => Linking.openURL(ctx.pr!.url)} accessibilityRole="link" style={styles.row}>
                <Text style={[type.body, { flex: 1 }]}>Pull request #{ctx.pr.number}</Text>
                <ArrowSquareOut size={16} color={c.muted} weight="bold" />
              </Pressable>
              <Text style={[type.label, { color: proof ? (proof.ok ? c.green : c.red) : c.muted }]}>
                {proof
                  ? proof.ok
                    ? `Proven: ${proof.passed}/${proof.total} failing production requests now pass, tests pass`
                    : `Not proven: ${proof.passed}/${proof.total} pass${proof.tests ? '' : ', tests fail'}`
                  : 'CI is replaying the failing requests'}
              </Text>
            </Block>
          )}

          {ctx.pr && (
            <Block title="Changes">
              {diff === null && <Text style={type.caption}>Loading the diff…</Text>}
              {typeof diff === 'string' && <Text style={type.caption}>{diff}</Text>}
              {Array.isArray(diff) && diff.map((f) => (
                <View key={f.file} style={styles.file}>
                  <Text style={type.monoStrong}>
                    {f.file}  <Text style={{ color: c.green }}>+{f.additions}</Text> <Text style={{ color: c.red }}>−{f.deletions}</Text>
                  </Text>
                  <ScrollView horizontal>
                    <Text style={type.monoCaption}>
                      {f.patch.split('\n').map((line, n) => (
                        <Text key={n} style={{ color: line.startsWith('+') ? c.green : line.startsWith('-') ? c.red : c.muted }}>
                          {line}{'\n'}
                        </Text>
                      ))}
                    </Text>
                  </ScrollView>
                </View>
              ))}
            </Block>
          )}

          {resolved && (
            <Block title="Why it happened">
              {pm === null && <Text style={type.caption}>Writing the postmortem…</Text>}
              {typeof pm === 'string' && <Text style={type.caption}>{pm}</Text>}
              {pm && typeof pm === 'object' && (
                <>
                  <Text style={type.body}>{pm.why}</Text>
                  <Text style={[type.label, { color: c.muted, marginTop: space.sm }]}>Prevent it next time</Text>
                  {pm.prevent.map((step, n) => (
                    <Text key={n} style={type.body}>{n + 1}. {step}</Text>
                  ))}
                </>
              )}
            </Block>
          )}

          <Block title="Timeline">
            <Line when={i.created_at} what="Detected and confirmed" />
            {steps.map((a) => (
              <Line
                key={a.id}
                when={a.created_at}
                what={`${fixFor(a.action).label}: ${a.outcome}${a.detail && !a.detail.startsWith('https://') ? ` (${a.detail})` : ''}`}
              />
            ))}
            {ctx.self_healed && i.recovered_at && <Line when={i.recovered_at} what="Recovered on its own, no fix needed" />}
            {!ctx.self_healed && i.recovered_at && <Line when={i.recovered_at} what="Back up (health check passed)" />}
            {i.recovered_at && (
              <Text style={type.caption}>
                {recoveryLine(i) || `down ${formatDuration(Date.parse(i.recovered_at) - Date.parse(i.created_at))}`}
                {lostLine(i) ? ` · ${lostLine(i)}` : ''}
              </Text>
            )}
          </Block>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <Text style={[type.label, { color: c.muted }]}>{title}</Text>
      {children}
    </View>
  );
}

function Line({ when, what }: { when: string; what: string }) {
  return (
    <View style={styles.row}>
      <Text style={[type.monoCaption, { width: 76 }]}>{new Date(when).toLocaleTimeString(undefined, { timeStyle: 'medium' })}</Text>
      <Text style={[type.body, { flex: 1, fontSize: 14 }]}>{what}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg, paddingHorizontal: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 64, gap: space.md },
  icon: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  body: { gap: space.md, paddingBottom: space.xxl },
  meta: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  block: { backgroundColor: c.surface, borderRadius: radius.card, padding: space.lg, gap: space.sm },
  list: { gap: 4, marginTop: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  file: { gap: space.xs, paddingTop: space.xs },
});
