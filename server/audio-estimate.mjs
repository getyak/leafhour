// Reference rates checked on 2026-10-15. Never treat an estimate as a bill.
// Audio token conversion: https://cloud.google.com/text-to-speech/pricing
const source='https://openrouter.ai/google/gemini-3.8-flash-tts';
export function estimateAudio(clips,model,now=new Date()){
 const characters=clips.reduce((n,c)=>n+c.text.length,0),seconds=Math.ceil(clips.reduce((n,c)=>n+c.text.length/(c.language==='zh'?4:14),0));
 const known=model==='google/gemini-3.8-flash-tts'&&now>=new Date('2026-10-15T00:00:00Z')&&now<new Date('2027-01-01T00:00:00Z');
 const usdRange=known?{currency:'USD',low:seconds*.7*25*9/1e6+characters/4*.5/1e6,high:seconds*1.5*25*9/1e6+characters*.5/1e6,source,checkedAt:'2026-10-15',expiresAt:'2026-12-31'}:null;
 return {seconds,approximate:true,usdRange};
}
