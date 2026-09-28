// The Activity tab: every fix attempt (the audit log), grouped by day, and how fast services came back.
import { ArrowSquareOut, ClockCounterClockwise } from 'phosphor-react-native';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AuditEntry, Incident } from './api';
import { fixFor } from './fixes';
import { recoveryLine, timeAgo } from './format';
import { c, radius, space, type } from './theme';
import { Chip, Section } from './ui';

const OUTCOME = {
  executed: { label: 'Executed', color: c.green, tint: c.greenTint },
  paywalled: { label: 'Paywalled', color: c.amber, tint: c.amberTint },
  failed: { label: 'Failed', color: c.red, tint: c.redTint },
} as const;

const dayLabel = (iso: string, now: number) => {
  const d = new Date(iso);
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

export function Activity({ audit, fixed, now }: { audit: AuditEntry[]; fixed: Incident[]; now: number }) {
  const days: [string, AuditEntry[]][] = [];
  for (const a of audit) {
    const label = dayLabel(a.created_at, now);
    const last = days[days.length - 1];
    if (last?.[0] === label) last[1].push(a);
    else days.push([label, [a]]);
  }

  // Which approved fix brought it back, so each recovery reads as one story.
  const fixUsed = (id: string) => {
    const a = audit.find((x) => x.incident_id === id && x.outcome === 'executed');
    return a ? fixFor(a.action).label : null;
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={[type.display, { marginTop: space.md }]} accessibilityRole="header">Activity</Text>

      {fixed.length > 0 && (
        <Section title="Recoveries">
          <View style={styles.group}>
            {fixed.map((f) => (
              <View key={f.id} style={styles.row}>
                <View style={[styles.dot, { backgroundColor: f.recovered_at ? c.green : c.amber }]} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={type.mono}>{f.target_server}</Text>
                  <Text style={type.caption}>{[fixUsed(f.id), recoveryLine(f)].filter(Boolean).join(' · ')}</Text>
                </View>
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

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxl, gap: space.sm },
  group: { backgroundColor: c.surface, borderRadius: radius.card, padding: space.lg, gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 24 },
  dot: { width: 8, height: 8, borderRadius: 4 },
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
