import { initialHandoff, sceneHandoff, sceneInputBlocked, type SceneDestination, type SceneHandoff } from '@/utils/sceneTransition';

const scene = (key: string): SceneDestination => ({ key, phase: key.split(':')[0], label: key, canvas: true });
const city = scene('location:city');
const world = scene('worldmap');
const combat = scene('combat:wolves');
const send = (state: SceneHandoff, type: 'covered' | 'ready' | 'revealed' | 'failed') =>
  sceneHandoff(state, { type, generation: state.generation });
const settled = (target: SceneDestination) => send(send(initialHandoff(target), 'ready'), 'revealed');

test('outgoing scene survives until covered; incoming stays covered and untappable until ready and revealed', () => {
  const old = settled(world);
  expect(sceneInputBlocked(old)).toBe(false);
  const requested = sceneHandoff(old, { type: 'request', target: city });
  expect(requested.mounted).toEqual(world);
  expect(requested.mountedGeneration).toBe(old.generation);
  expect(sceneInputBlocked(requested)).toBe(true);
  expect(send(requested, 'ready')).toBe(requested);
  const mounted = send(requested, 'covered');
  expect(mounted.mounted).toEqual(city);
  expect(mounted.stage).toBe('loading');
  expect(send(mounted, 'revealed')).toBe(mounted);
  const ready = send(mounted, 'ready');
  expect(sceneInputBlocked(ready)).toBe(true);
  expect(sceneInputBlocked(send(ready, 'revealed'))).toBe(false);
});

test.each(['covering', 'loading', 'revealing', 'failed'] as const)('a new request during %s wins over every stale callback', stage => {
  let old = sceneHandoff(settled(world), { type: 'request', target: combat });
  if (stage !== 'covering') old = send(old, 'covered');
  if (stage === 'revealing') old = send(old, 'ready');
  if (stage === 'failed') old = send(old, 'failed');
  const next = sceneHandoff(old, { type: 'request', target: city });
  for (const type of ['covered', 'ready', 'revealed', 'failed'] as const) {
    expect(sceneHandoff(next, { type, generation: old.generation })).toBe(next);
  }
  expect(send(next, 'covered').mounted).toEqual(city);
  expect(sceneInputBlocked(next)).toBe(true);
});

test('same-phase location changes and castle stages create distinct handoffs', () => {
  for (const [from, to] of [[city, scene('location:lair_warren')], [combat, scene('combat:castle_2')]]) {
    const old = settled(from);
    const next = sceneHandoff(old, { type: 'request', target: to });
    expect(next.generation).toBeGreaterThan(old.generation);
    expect(next.mounted).toEqual(from);
    expect(send(next, 'covered').mounted).toEqual(to);
  }
});

test('failed and timed-out loads stay shielded and retry creates a new instance', () => {
  const loading = initialHandoff(city);
  const failed = send(loading, 'failed');
  expect(failed.stage).toBe('failed');
  expect(sceneInputBlocked(failed)).toBe(true);
  expect(send(failed, 'ready')).toBe(failed);
  const requested = sceneHandoff(failed, { type: 'retry', generation: failed.generation });
  expect(requested.mountedFailed).toBe(true);
  const retry = send(requested, 'covered');
  expect(retry.mountedFailed).toBe(false);
  expect(retry.mountedGeneration).toBeGreaterThan(loading.mountedGeneration);
  expect(sceneHandoff(retry, { type: 'ready', generation: loading.generation })).toBe(retry);
  expect(send(retry, 'ready').stage).toBe('revealing');
});

test('returning to the outgoing scene cancels the superseded destination', () => {
  const requested = sceneHandoff(settled(city), { type: 'request', target: combat });
  const returned = sceneHandoff(requested, { type: 'request', target: city });
  expect(send(returned, 'covered').mounted).toEqual(city);
  expect(sceneHandoff(returned, { type: 'covered', generation: requested.generation })).toBe(returned);
});

test('duplicate requests, readiness and animation completions cannot restart a settled scene', () => {
  const old = settled(city);
  expect(sceneHandoff(old, { type: 'request', target: city })).toBe(old);
  expect(send(old, 'ready')).toBe(old);
  expect(send(old, 'revealed')).toBe(old);
  expect(send(old, 'failed')).toBe(old);
  expect(sceneHandoff(old, { type: 'retry', generation: old.generation })).toBe(old);
});

test('queued retry from a superseded failure cannot restart the new destination', () => {
  const failed = send(initialHandoff(city), 'failed');
  const next = sceneHandoff(failed, { type: 'request', target: combat });
  expect(sceneHandoff(next, { type: 'retry', generation: failed.generation })).toBe(next);
});
