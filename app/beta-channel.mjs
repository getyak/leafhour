// Public destinations only. An Apple-processed build is not an installation link.
export const betaChannels=Object.freeze({testflightUrl:'https://testflight.apple.com/join/b5vYwr4Z',supportEmail:'support@leafhour.com'});

export function publicTestFlightUrl(value){
 return typeof value==='string'&&/^https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]{6,32}$/.test(value)?value:null;
}

const emailCopy={
 en:['Feedback','Platform','Version / device','What happened / what I expected'],
 'zh-Hans':['使用反馈','使用平台','版本 / 设备','遇到的问题 / 预期的效果'],
 'zh-Hant':['使用回饋','使用平台','版本 / 裝置','遇到的問題 / 預期的效果'],
 ja:['フィードバック','利用環境','バージョン / 端末','起きたこと / 期待した動作'],
};
const clean=(value,max)=>Array.from(String(value??'').toWellFormed()).slice(0,max).join('').trim();
export function composeBetaFeedback({locale='en',platform='Web',version='',description=''}={}){
 if(!['Web','iOS'].includes(platform))throw new TypeError('Invalid feedback platform');
 const c=emailCopy[locale]||emailCopy.en,detail=clean(description,1600);
 if(!detail)throw new TypeError('A feedback description is required');
 const subject=`[Leafhour beta] ${platform} · ${c[0]}`;
 const body=`${c[1]}: ${platform}\n${c[2]}: ${clean(version,80).replace(/[\r\n]+/g,' ')}\n\n${c[3]}:\n${detail}`;
 const encode=value=>encodeURIComponent(value);
 return {mailto:`mailto:${betaChannels.supportEmail}?subject=${encode(subject)}&body=${encode(body)}`,text:`${betaChannels.supportEmail}\n${subject}\n\n${body}`};
}
