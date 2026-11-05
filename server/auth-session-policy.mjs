import {authFailure} from './auth-policy.mjs';

const windows={web:30*86400000,ios:90*86400000};
export function sessionClient(value='web'){
  if(!Object.hasOwn(windows,value))throw authFailure('auth.error.generic','登录方式无效',400);
  return value;
}
export function sessionState(now,client='web'){
  client=sessionClient(client);
  return {sessionPolicy:'idle-v1',client,lastActiveAt:now,expiresAt:now+windows[client]};
}
export function renewSession(row,now,client='web'){
  // Client selection controls retention only; it never grants account access.
  client=sessionClient(client);if(row.client==='ios')client='ios';
  const state=sessionState(Math.max(now,row.lastActiveAt||0),client);
  Object.assign(row,state,{expiresAt:Math.max(row.expiresAt,state.expiresAt)});
  return {user:row.user,expiresAt:row.expiresAt,maxAge:windows[client]/1000};
}
export const sessionMaxAge=client=>windows[sessionClient(client)]/1000;
export function sessionCookie(token,{secure=false}={}){
  // Only sign-in/out may write this shared cookie. A late activity response
  // must never replace the credential of a newer account/session.
  return `marginalia_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?31536000:0}${secure?'; Secure':''}`;
}
