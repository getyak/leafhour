// Homepage language detection without loading the authored copy catalog.
export const homeLocale=doc=>{
 const lang=doc?.documentElement?.lang||'';
 if(lang.startsWith('en'))return 'en';
 if(lang.startsWith('ja'))return 'ja';
 if(/^zh-(?:hant|tw|hk|mo)/i.test(lang))return 'zh-Hant';
 return 'zh-Hans';
};
