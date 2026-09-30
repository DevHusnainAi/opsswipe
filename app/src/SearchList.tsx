// A pick list that stays a fixed height however many items there are, with a search box: accounts with
// dozens of repos, projects or VMs scroll inside the list instead of pushing the button off-screen.
import { MagnifyingGlass } from 'phosphor-react-native';
import { type ReactNode, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { c, radius, space, TARGET, type } from './theme';

export function SearchList<T>(
  { items, text, render, placeholder, height = 280, pinned }: {
    items: T[];
    text: (item: T) => string; // what the search matches
    render: (item: T) => ReactNode;
    placeholder: string;
    height?: number;
    pinned?: ReactNode; // always shown first, never filtered (e.g. "No repo")
  },
) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter((i) => text(i).toLowerCase().includes(needle)) : items;
  return (
    <View style={{ gap: space.sm }}>
      {items.length > 5 && (
        <View style={styles.search}>
          <MagnifyingGlass size={16} color={c.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={placeholder}
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={placeholder}
            style={[type.body, styles.input]}
          />
        </View>
      )}
      <ScrollView style={[styles.list, { maxHeight: height }]} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {pinned}
        {shown.map(render)}
        {!!needle && shown.length === 0 && <Text style={[type.caption, { padding: space.md }]}>Nothing matches “{q}”.</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: TARGET,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  input: { flex: 1, paddingVertical: space.sm, color: c.text },
  list: { borderRadius: radius.control, borderWidth: 1, borderColor: c.border },
});
