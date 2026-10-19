// Only this exact domain cause permits offering the corresponding original.
// Unknown provider codes and prose never imply that a translation is missing.
export const audioFailureCode=(status,code)=>status===409&&code==='missing_translation'?'missing_translation':null;
