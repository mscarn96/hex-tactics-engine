// `src/platform/keyValueStore.ts` for a suite that wants to spy on its calls: an in-memory store
// whose methods are `jest.fn()`s. Used as `jest.mock('@/platform/keyValueStore', () =>
// require('@/__mocks__/keyValueStoreMock'))`.
let values = {};

module.exports = {
  __INTERNAL_MOCK_STORAGE__: values,
  getItem: jest.fn(async (key) => values[key] ?? null),
  setItem: jest.fn(async (key, value) => {
    values[key] = value;
  }),
  removeItem: jest.fn(async (key) => {
    delete values[key];
  }),
  clear: jest.fn(async () => {
    values = {};
    module.exports.__INTERNAL_MOCK_STORAGE__ = values;
  }),
  getAllKeys: jest.fn(async () => Object.keys(values)),
};
