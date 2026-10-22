import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {authFixture} from './auth-fixture.mjs';
test('trial identity uses fresh verified provider facts without expanding public login user fields',async()=>{
 const fixture=authFixture(),auth=createHostedAuth({store:fixture.store(),env:fixture.env,fetcher:fixture.fetcher});
 const session=await auth.signInPassword('reader@example.com','valid-password-123');
 assert.equal(typeof auth.emailVerifiedFor,'function');
 assert.equal(await auth.emailVerifiedFor(session.token),true);
 assert.equal(Object.hasOwn(session.user,'emailVerified'),false);
 fixture.user.email_confirmed_at=null;
 assert.equal(await auth.emailVerifiedFor(session.token),false);
 await auth.logout(session.token);
 assert.equal(await auth.emailVerifiedFor(session.token),false);
});
