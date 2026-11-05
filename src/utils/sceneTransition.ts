/** Presentation handoff only; campaign phase remains owned by gameStore. */
export interface SceneDestination {
  key: string;
  phase: string;
  label: string;
  canvas: boolean;
}

export interface SceneHandoff {
  target: SceneDestination;
  mounted: SceneDestination;
  generation: number;
  mountedGeneration: number;
  mountedFailed: boolean;
  stage: 'covering' | 'loading' | 'revealing' | 'idle' | 'failed';
}

export type SceneHandoffEvent =
  | { type: 'request'; target: SceneDestination }
  | { type: 'covered' | 'ready' | 'revealed' | 'failed'; generation: number }
  | { type: 'retry'; generation: number };

export const SCENE_LOAD_TIMEOUT_MS = 60_000;
export const SCENE_REVEAL_MS = 180;

export function initialHandoff(target: SceneDestination): SceneHandoff {
  return { target, mounted: target, generation: 0, mountedGeneration: 0, mountedFailed: false, stage: 'loading' };
}

export function sceneHandoff(state: SceneHandoff, event: SceneHandoffEvent): SceneHandoff {
  if (event.type === 'request') {
    if (event.target.key === state.target.key) return state;
    return { ...state, target: event.target, generation: state.generation + 1, stage: 'covering' };
  }
  if (event.type === 'retry') {
    if (event.generation !== state.generation || state.stage !== 'failed') return state;
    return { ...state, generation: state.generation + 1, stage: 'covering' };
  }
  if (event.generation !== state.generation) return state;
  switch (event.type) {
    case 'covered':
      return state.stage === 'covering' ? { ...state, mounted: state.target, mountedGeneration: state.generation, mountedFailed: false, stage: 'loading' } : state;
    case 'ready':
      return state.stage === 'loading' ? { ...state, stage: 'revealing' } : state;
    case 'revealed':
      return state.stage === 'revealing' ? { ...state, stage: 'idle' } : state;
    case 'failed':
      return state.stage === 'loading' || state.stage === 'revealing' ? { ...state, mountedFailed: true, stage: 'failed' } : state;
  }
}

export function sceneInputBlocked(state: SceneHandoff): boolean {
  return state.stage !== 'idle';
}
