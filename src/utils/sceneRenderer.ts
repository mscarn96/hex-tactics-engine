/**
 * R3F invokes renderer setup from an unawaited async effect. Report factory
 * errors without rejecting that effect: its pending setup is abandoned when
 * the failure cover unmounts the canvas. Retry gets a new renderer and root.
 */
export async function prepareSceneRenderer<T>(create: () => T, failed: () => void): Promise<T> {
  try {
    return create();
  } catch {
    failed();
    return new Promise<T>(() => {});
  }
}
