import type { BreakTimer } from './timer';

interface PowerEvents {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
  getSystemIdleState?(threshold: number): string;
}

export function bindPowerEvents(power: PowerEvents, timer: BreakTimer): () => void {
  const events: [string, () => void][] = [
    ['suspend', () => timer.setSystemPaused('sleep', true)],
    ['resume', () => timer.setSystemPaused('sleep', false)],
    ['lock-screen', () => timer.setSystemPaused('lock', true)],
    ['unlock-screen', () => timer.setSystemPaused('lock', false)],
  ];
  for (const [name, listener] of events) power.on(name, listener);
  if (power.getSystemIdleState?.(1) === 'locked') timer.setSystemPaused('lock', true);
  return () => { for (const [name, listener] of events) power.off(name, listener); };
}
