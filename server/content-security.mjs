const base="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const checkout=base.replace("script-src 'self'","script-src 'self' https://www.creem.io").replace("style-src 'self'","style-src 'self' 'unsafe-inline'")+"; frame-src 'self' https://creem.io https://*.creem.io";

// Other pages keep the existing self-only script/style policy. Card fields and
// bank authentication live in the payment provider's cross-origin frame.
export function contentSecurityPolicy(pathname=''){
 return /^\/(?:(?:en|zh-hans|zh-hant|ja)\/)?pricing(?:\.html|\/index\.html|\/)?$/.test(pathname)||/^\/billing(?:\.html|\/)?$/.test(pathname)?checkout:base;
}
