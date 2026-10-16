// The public signature must be the same before and after sealing a letter.
export function publicGiftSender(profile){
  const name=profile?.displayName||profile?.name;
  return typeof name==='string'&&name.trim()&&name.length<=80&&!/[\u0000-\u001f@]/u.test(name)?name.trim():'一位读者';
}
