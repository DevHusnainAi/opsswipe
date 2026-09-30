// Which GitHub repo a service deploys from. Linking one enables the code fixes (revert PR, AI fix,
// merge once CI proves it). Only repos the OpsSwipe GitHub App can reach are listed.
import { GitBranch } from 'phosphor-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { connect } from './api';
import { SearchList } from './SearchList';
import { c, space, TARGET, type } from './theme';

export type Repo = { name: string; branch: string };

export function RepoPicker(
  { value, onChange, githubConnected }: { value: string | null; onChange: (repo: string | null) => void; githubConnected: boolean },
) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!githubConnected) return;
    connect<{ repos: Repo[] }>('github_repos').then((r) => setRepos(r.repos)).catch((e) => setError(e.message));
  }, [githubConnected]);

  if (!githubConnected) {
    return (
      <Text style={type.caption}>
        Connect GitHub in Services → Connections to link a repo. That turns on revert PRs, AI fixes and CI proof.
      </Text>
    );
  }

  const row = (r: Repo | null) => {
    const on = (r?.name ?? null) === value;
    return (
      <Pressable
        key={r?.name ?? 'none'}
        onPress={() => onChange(r?.name ?? null)}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        style={[styles.row, on && styles.rowOn]}
      >
        <View style={[styles.radio, on && styles.radioOn]} />
        <View style={{ flex: 1 }}>
          <Text style={r ? type.mono : type.body} numberOfLines={1}>{r?.name ?? 'No repo'}</Text>
          {r
            ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <GitBranch size={12} color={c.muted} />
                <Text style={type.caption}>{r.branch}</Text>
              </View>
            )
            : <Text style={type.caption}>Only restarts, rollbacks and reboots</Text>}
        </View>
      </Pressable>
    );
  };
  return (
    <View style={{ gap: space.sm }}>
      <Text style={type.label}>Linked repo</Text>
      {error && <Text style={[type.caption, { color: c.red }]}>{error}</Text>}
      {!repos && !error && <ActivityIndicator color={c.green} style={{ alignSelf: 'flex-start' }} />}
      {repos && (
        <SearchList items={repos} text={(r) => r.name} render={row} pinned={row(null)} placeholder="Search repos" />
      )}
      {repos?.length === 0 && (
        <Text style={type.caption}>The OpsSwipe GitHub App can&apos;t see any repos yet. Add repos to its installation on GitHub.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TARGET,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  rowOn: { backgroundColor: c.greenTint },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: c.borderStrong },
  radioOn: { borderColor: c.green, backgroundColor: c.green },
});
