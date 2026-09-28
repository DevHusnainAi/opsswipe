// Settings → Agent access: tokens that let an AI agent (an AI SRE, a script, CI) propose fixes.
// A proposal arrives as a card marked with the agent's name; nothing runs until you approve it.
import { Plus, Robot, Trash } from 'phosphor-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CopyRow } from './AddService';
import { connect } from './api';
import { timeAgo } from './format';
import { c, radius, space, TARGET, type } from './theme';
import { Button, Section, useNow } from './ui';

type Token = { id: string; name: string; created_at: string; last_used_at: string | null };

export function AgentAccess({ active }: { active: boolean }) {
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  const load = useCallback(async () => {
    const r = await connect<{ tokens: Token[]; url: string }>('agent_tokens');
    setTokens(r.tokens);
    setUrl(r.url);
  }, []);

  useEffect(() => {
    // Loads when Settings opens; state is only set after the await inside load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) load().catch((e) => setError(e.message));
  }, [active, load]);

  const create = async () => {
    setError(null);
    try {
      const r = await connect<{ name: string; token: string }>('agent_token_create', { name: name.trim() });
      setCreated(r);
      setName('');
      setAdding(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const revoke = async (t: Token) => {
    if (confirm !== t.id) return setConfirm(t.id);
    setConfirm(null);
    await connect('agent_token_revoke', { id: t.id }).catch((e) => setError(e.message));
    await load();
  };

  const example = created &&
    `curl -X POST ${url} \\\n  -H "Authorization: Bearer ${created.token}" \\\n  -d '{"service":"my-app","action":"restart","reason":"Error rate spiked after 10:02"}'`;

  return (
    <Section title="Agent access">
      <View style={styles.group}>
        <View style={styles.intro}>
          <Robot size={24} color={c.text} />
          <Text style={[type.caption, { flex: 1 }]}>
            Let an AI agent propose fixes. Each proposal arrives as a card with the agent&apos;s name and reason; it runs
            only after you swipe and confirm with your fingerprint. The agent can check the result.
          </Text>
        </View>

        {error && <Text style={[type.label, { color: c.red }]}>{error}</Text>}

        {created && (
          <View style={styles.created}>
            <Text style={type.body}>
              Token for <Text style={{ fontWeight: '600' }}>{created.name}</Text>. Copy it now; it is shown only once.
            </Text>
            <CopyRow label="Agent token" value={created.token} />
            <CopyRow label="Try it" value={example!} />
            <Button label="Done" kind="secondary" onPress={() => setCreated(null)} />
          </View>
        )}

        {tokens?.map((t) => (
          <View key={t.id} style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.body}>{t.name}</Text>
              <Text style={type.caption}>{t.last_used_at ? `Last used ${timeAgo(t.last_used_at, now)}` : 'Never used'}</Text>
            </View>
            <Pressable onPress={() => revoke(t)} hitSlop={8} accessibilityRole="button" style={styles.revoke}>
              {confirm === t.id
                ? <Text style={[type.label, { color: c.red }]}>Tap to revoke</Text>
                : <Trash size={20} color={c.muted} />}
            </Pressable>
          </View>
        ))}

        {adding ? (
          <View style={{ gap: space.sm, paddingVertical: space.md }}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Agent name, e.g. Incident bot"
              placeholderTextColor={c.muted}
              style={styles.input}
              accessibilityLabel="Agent name"
              autoFocus
            />
            <Button label="Create token" onPress={create} />
          </View>
        ) : (
          <Pressable onPress={() => setAdding(true)} accessibilityRole="button" style={styles.add}>
            <Plus size={20} color={c.green} weight="bold" />
            <Text style={[type.label, { color: c.green, fontSize: 15 }]}>New agent token</Text>
          </Pressable>
        )}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  group: { backgroundColor: c.surface, borderRadius: radius.card, paddingHorizontal: space.lg, paddingVertical: space.sm },
  intro: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.md },
  created: { gap: space.md, paddingVertical: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TARGET, borderTopWidth: 1, borderTopColor: c.border },
  revoke: { minHeight: TARGET, justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TARGET, borderTopWidth: 1, borderTopColor: c.border },
  input: {
    minHeight: 48,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.bg,
    paddingHorizontal: space.md,
    color: c.text,
  },
});
