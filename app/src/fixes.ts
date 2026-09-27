// Display metadata for each allowlisted fix. The server decides what's allowed; this only words it.
import type { Icon } from 'phosphor-react-native';
import { ArrowClockwise, ArrowCounterClockwise, GitMerge, GitPullRequest, Power } from 'phosphor-react-native';

export type Fix = {
  label: string; // picker chip
  rail: string; // swipe track
  verb: string; // "Roll back web?"
  doing: string; // banner while running
  confirm: string; // fingerprint prompt description
  icon: Icon;
};

export const FIXES: Record<string, Fix> = {
  reset: {
    label: 'Reset VM',
    rail: 'Swipe to reset',
    verb: 'Reset',
    doing: 'Resetting',
    confirm: 'Hard-reboots the VM. It can\'t be undone.',
    icon: Power,
  },
  restart: {
    label: 'Restart',
    rail: 'Swipe to restart',
    verb: 'Restart',
    doing: 'Restarting',
    confirm: 'Restarts the running service. It can\'t be undone.',
    icon: ArrowClockwise,
  },
  rollback: {
    label: 'Roll back',
    rail: 'Swipe to roll back',
    verb: 'Roll back',
    doing: 'Rolling back',
    confirm: 'Puts the previous release back live.',
    icon: ArrowCounterClockwise,
  },
  revert_pr: {
    label: 'Revert PR',
    rail: 'Swipe to open PR',
    verb: 'Open a revert PR for',
    doing: 'Opening a revert PR for',
    confirm: 'Opens a pull request. Production changes only after it is merged.',
    icon: GitPullRequest,
  },
  merge_pr: {
    label: 'Merge PR',
    rail: 'Swipe to merge',
    verb: 'Merge the proven PR for',
    doing: 'Merging the proven PR for',
    confirm: 'Merges the exact commit CI proved. Your host then deploys it.',
    icon: GitMerge,
  },
};

export const fixFor = (action: string) => FIXES[action] ?? FIXES.restart;
