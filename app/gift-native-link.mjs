// A tap opens the native preview. It does not accept a gift or carry an account token.
export function nativeGiftImportURL(token){
  return typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)?'leafhour://gift/'+token:null;
}
