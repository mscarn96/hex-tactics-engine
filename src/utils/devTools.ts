/** On only when a host sets the `__DEV__` global, unless `ENGINE_DEV_TOOLS` is `0`. */
export const DEV_TOOLS = typeof __DEV__ !== 'undefined' && !!__DEV__
  && process.env.ENGINE_DEV_TOOLS !== '0';

/** Save Creator: wherever the developer tools are, or with `ENGINE_SAVE_CREATOR=1`. */
export const SAVE_CREATOR = DEV_TOOLS
  || /^(1|true)$/i.test(process.env.ENGINE_SAVE_CREATOR ?? '');
