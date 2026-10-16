// Shared by local rendering and record validation. No generated CSS or remote fonts.
export const appearanceDefaults=Object.freeze({pageLayout:'scroll',font:22,theme:'system',fontFamily:'song',lineHeight:1.98,paragraphGap:24,letterSpacing:0.01,wordSpacing:0,fontWeight:400,indent:false,parallelLayout:'columns',parallelStyle:'plain',parallelColor:'auto',parallelBackground:'auto'});
export const appearanceChoices=Object.freeze({pageLayout:['scroll','spread'],theme:['system','paper','warm','mist','leaf','night'],fontFamily:['song','kai','sans'],parallelLayout:['columns','stack'],parallelStyle:['plain','muted','quote','tint','reveal'],parallelColor:['auto','green','blue','amber'],parallelBackground:['auto','none','soft']});
export const appearanceBounds=Object.freeze({font:[18,28,1],lineHeight:[1.4,2.4,0.1],paragraphGap:[8,48,4],letterSpacing:[-0.04,0.1,0.01],wordSpacing:[0,0.2,0.02],fontWeight:[300,700,50]});
export function normalizeAppearance(source={},strict=false){
  const result={...appearanceDefaults};
  for(const key of Object.keys(result)){
    const value=source[key];if(value===undefined)continue;
    const range=appearanceBounds[key];
    const valid=range?Number.isFinite(value)&&value>=range[0]&&value<=range[1]:appearanceChoices[key]?appearanceChoices[key].includes(value):typeof value==='boolean';
    if(valid)result[key]=value;else if(strict)throw new Error('阅读偏好格式不正确');
  }
  return result;
}

// Reopening restores the place and typography, while the original leads each visit.
export function openingReadingPreferences(position={}){
  return {...normalizeAppearance(position),mode:'en',variant:position.variant==='literal'?'literal':'interpretive'};
}
