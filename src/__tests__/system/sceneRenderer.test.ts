import { prepareSceneRenderer } from '@/utils/sceneRenderer';

test('a successful factory returns its renderer without signalling failure', async () => {
  const renderer = {};
  const failed = jest.fn();
  expect(await prepareSceneRenderer(() => renderer, failed)).toBe(renderer);
  expect(failed).not.toHaveBeenCalled();
});

test('setup failure signals recovery without an unhandled async rejection; retry uses a fresh factory', async () => {
  const failed = jest.fn();
  const settled = jest.fn();
  void prepareSceneRenderer(() => { throw new Error('no graphics context'); }, failed).then(settled, settled);
  await Promise.resolve();
  expect(failed).toHaveBeenCalledTimes(1);
  expect(settled).not.toHaveBeenCalled();
  const renderer = {};
  expect(await prepareSceneRenderer(() => renderer, failed)).toBe(renderer);
  expect(failed).toHaveBeenCalledTimes(1);
});
