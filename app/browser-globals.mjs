// Build-only injection: these identities are stable for a browser document's
// lifetime. Local bindings let the minifier shorten repeated global names.
export const document=globalThis.document;
export const window=globalThis.window;
export const performance=globalThis.performance;
export const location=globalThis.location;
export const navigator=globalThis.navigator;
export const Object=globalThis.Object;
export const Array=globalThis.Array;
export const JSON=globalThis.JSON;
export const Math=globalThis.Math;
