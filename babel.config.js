// The app previously had no babel.config.js and relied on Expo's implicit
// `babel-preset-expo`. Lingui needs its macro plugin registered, so the default
// is now spelled out here.
//
// Ordering matters: `@lingui/babel-plugin-lingui-macro` must expand the `t` /
// `Trans` macros BEFORE React Compiler runs, or the compiler rewrites code the
// macro can no longer recognise. React Compiler is enabled through
// `app.json` -> `experiments.reactCompiler`, and Expo applies it from inside
// `babel-preset-expo`. Babel always runs top-level `plugins` before any plugin
// contributed by a `presets` entry, so listing the macro here is sufficient --
// no patching or preset surgery required.
//
// `react-native-worklets/plugin` must be **last**, which is its own documented
// requirement: it rewrites every `'worklet'` function into the serialized form
// the native runtime unpacks, so anything that rewrites code after it would
// produce a worklet the unpacker cannot read.
//
// It is listed explicitly because nothing else adds it: `babel-preset-expo`
// contains no reference to it or to reanimated's older `reanimated/plugin`.
// Worklets 0.10 tolerated its absence; 0.11 does not -- `WorkletRuntime::init`
// now goes through `UnpackerLoader::installUnpacker`, which calls
// `jsi::Value::getObject()` on what the plugin was supposed to emit and aborts
// the process with `assertion "isObject()" failed` when the plugin never ran.
// That is a SIGABRT on the JS thread immediately after `Running "main"`, with
// no JavaScript error to read, which is why this comment is longer than the
// line it explains.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['@lingui/babel-plugin-lingui-macro', 'react-native-worklets/plugin'],
  };
};
