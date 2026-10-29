import {clientFromEnvironment,verifyApp} from './app-store-connect.mjs';
const client=clientFromEnvironment();
const app=await verifyApp(client,{appId:process.env.IOS_APP_ID,bundleId:process.env.IOS_BUNDLE_ID});
const query=new URLSearchParams({'fields[betaGroups]':'name,isInternalGroup,hasAccessToAllBuilds,publicLinkEnabled',limit:'200'});
const groups=await client.get(`/v1/apps/${app.appId}/betaGroups?${query}`);
if(groups.links?.next)throw Error('Group list is paginated; review explicitly before drawing conclusions');
console.log(JSON.stringify({mode:'audit-only',app,groups:(groups.data??[]).map(({id,attributes})=>({id,...attributes})),note:'No tester invitations, repairs, assignments, group edits or public links were created. Physical installation and retained-data updates require separate evidence.'},null,2));
