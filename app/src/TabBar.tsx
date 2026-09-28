// Bottom tabs. Plain state, no navigation library: four fixed screens need no router, and it runs in
// Expo Go and our builds alike without a native rebuild.
import type { Icon } from 'phosphor-react-native';
import { ClockCounterClockwise, GearSix, Plug, Siren } from 'phosphor-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { c, space, type } from './theme';

export type Tab = 'incidents' | 'services' | 'activity' | 'settings';

const TABS: { key: Tab; label: string; icon: Icon }[] = [
  { key: 'incidents', label: 'Incidents', icon: Siren },
  { key: 'services', label: 'Services', icon: Plug },
  { key: 'activity', label: 'Activity', icon: ClockCounterClockwise },
  { key: 'settings', label: 'Settings', icon: GearSix },
];

export function TabBar({ tab, onChange, alerts }: { tab: Tab; onChange: (t: Tab) => void; alerts: number }) {
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {TABS.map(({ key, label, icon: IconCmp }) => {
        const on = key === tab;
        const badge = key === 'incidents' && alerts > 0;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={badge ? `${label}, ${alerts} open` : label}
            style={styles.item}
          >
            <View>
              <IconCmp size={24} color={on ? c.green : c.muted} weight={on ? 'fill' : 'regular'} />
              {badge && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{alerts > 9 ? '9+' : alerts}</Text>
                </View>
              )}
            </View>
            <Text style={[type.caption, { color: on ? c.text : c.muted, fontSize: 11 }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bg,
    marginHorizontal: -space.lg,
    paddingTop: space.sm,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 56 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: c.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: c.bg, fontSize: 10, fontWeight: '700' },
});
