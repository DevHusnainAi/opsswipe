// The Activity tab: every fix attempt (the audit log), grouped by day, and how fast services came back.
import { ArrowSquareOut, ClockCounterClockwise, ShareNetwork } from 'phosphor-react-native';
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import type { AuditEntry, Incident } from './api';
import { fixFor } from './fixes';
import { formatDuration, incidentReport, recoveryLine, timeAgo, weekStats } from './format';
import { c, radius, space, type } from './theme';
import { Chip, Section } from './ui';

const OUTCOME = {
  executed: { label: 'Executed', color: c.green, tint: c.greenTint },
  paywalled: { label: 'Paywalled', color: c.amber, tint: c.amberTint },
  failed: { label: 'Failed', color: c.red, tint: c.redTint },
  dismissed: { label: 'Dismissed', color: c.muted, tint: c.surface2 },
} as const;

const dayLabel = (iso: string, now: number) => {
  const d = new Date(iso);
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

export function Activity(
  { audit, fixed, now, onOpen }: { audit: AuditEntry[]; fixed: Incident[]; now: number; onOpen?: (i: Incident) => void },
) {
  const days: [string, AuditEntry[]][] = [];
  for (const a of audit) {
    const label = dayLabel(a.created_at, now);
    const last = days[days.length - 1];
    if (last?.[0] === label) last[1].push(a);
    else days.push([label, [a]]);
  }

  // Which approved fix brought it back, so each recovery reads as one story.
  const fixUsed = (id: string) => {
    const a = audit.find((x) => x.incident_id === id && (x.outcome === 'executed' || x.outcome === 'dismissed'));
    return a ? fixFor(a.action).label : null;
  };
  const dismissed = (id: string) => audit.some((x) => x.incident_id === id && x.outcome === 'dismissed');

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={[type.display, { marginTop: space.md }]} accessibilityRole="header">Activity</Text>

      {fixed.length > 0 && <Stats {...weekStats(fixed, now)} />}

      {fixed.length > 0 && (
        <Section title="Recoveries">
          <View style={styles.group}>
            {fixed.map((f) => (
              <View key={f.id} style={styles.row}>
                <View style={[styles.dot, { backgroundColor: f.recovered_at ? c.green : c.amber }]} />
                <Pressable
                  onPress={() => onOpen?.(f)}
                  disabled={!onOpen}
                  accessibilityRole="button"
                  accessibilityHint="Opens the incident: cause, AI opinion and timeline"
                  style={{ flex: 1, gap: 2 }}
                >
                  <Text style={type.mono}>{f.target_server}</Text>
                  <Text style={type.caption}>
                    {dismissed(f.id) ? 'Dismissed as a false alarm' : [fixUsed(f.id), recoveryLine(f)].filter(Boolean).join(' · ')}
                  </Text>
                </Pressable>
                {/* Telling users what happened, in one tap: post it to a status page, X or Discord. */}
                {f.recovered_at && !dismissed(f.id) && (
                  <Pressable
                    onPress={() => Share.share({ message: incidentReport(f, fixUsed(f.id)) })}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={`Share what happened to ${f.target_server}`}
                  >
                    <ShareNetwork size={20} color={c.muted} weight="bold" />
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        </Section>
      )}

      {audit.length === 0 ? (
        <View style={styles.empty}>
          <ClockCounterClockwise size={32} color={c.muted} weight="bold" />
          <Text style={[type.body, { textAlign: 'center' }]}>No fixes yet</Text>
          <Text style={[type.caption, { textAlign: 'center' }]}>
            Every fix you approve, and every one that is blocked or fails, is recorded here.
          </Text>
        </View>
      ) : (
        days.map(([label, entries]) => (
          <Section key={label} title={label}>
            <View style={styles.group}>
              {entries.map((a) => {
                const o = OUTCOME[a.outcome as keyof typeof OUTCOME] ?? OUTCOME.failed;
                const link = a.detail?.match(/https:\/\/\S+/)?.[0];
                return (
                  <Pressable
                    key={a.id}
                    disabled={!link}
                    onPress={() => link && Linking.openURL(link)}
                    accessibilityRole={link ? 'link' : undefined}
                    accessibilityLabel={`${o.label}: ${fixFor(a.action).label} ${a.target}, ${timeAgo(a.created_at, now)}`}
                    style={styles.row}
                  >
                    <Chip label={o.label} color={o.color} tint={o.tint} />
                    <Text style={[type.mono, { flex: 1 }]} numberOfLines={1}>
                      {fixFor(a.action).label} {a.target}
                    </Text>
                    {link ? (
                      <ArrowSquareOut size={16} color={c.muted} weight="bold" />
                    ) : (
                      <Text style={type.monoCaption}>{timeAgo(a.created_at, now)}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </Section>
        ))
      )}
    </ScrollView>
  );
}

function Stats({ incidents, median, proven }: { incidents: number; median: number | null; proven: number }) {
  const tiles = [
    ['Incidents this week', String(incidents)],
    ['Median time to recover', median === null ? '–' : formatDuration(median)],
    ['Fixes proven in CI', String(proven)],
  ];
  return (
    <View style={styles.stats} accessibilityLabel={tiles.map(([k, v]) => `${k}: ${v}`).join('. ')}>
      {tiles.map(([label, value]) => (
        <View key={label} style={styles.tile}>
          <Text style={[type.title, { fontVariant: ['tabular-nums'] }]}>{value}</Text>
          <Text style={type.caption}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxl, gap: space.sm },
  group: { backgroundColor: c.surface, borderRadius: radius.card, padding: space.lg, gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 24 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  stats: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  tile: { flex: 1, backgroundColor: c.surface, borderRadius: radius.card, padding: space.md, gap: 2 },
  empty: {
    marginTop: space.xl,
    borderWidth: 1,
    borderColor: c.border,
    borderStyle: 'dashed',
    borderRadius: radius.card,
    alignItems: 'center',
    gap: space.sm,
    padding: space.xl,
  },
});
