import {createHostedStore} from '../deploy/hosted-store.mjs';

export function authFixture({onProvider}={}){
  const rows=new Map(),calls=[];
  const env={SUPABASE_URL:'https://auth.example.com',SUPABASE_SECRET_KEY:'server-fixture',SUPABASE_PUBLISHABLE_KEY:'publishable-fixture',READER_PUBLIC_ORIGIN:'https://reader.example.com',READER_EMAIL_ENABLED:'true'};
  const user={id:'user-a',email:'reader@example.com',email_confirmed_at:'2026-10-14T00:00:00Z',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{}};
  const providerSession=()=>({user,access_token:'access-fixture',refresh_token:'refresh-fixture',expires_in:3600,token_type:'bearer'});
  const fetcher=async(input,options={})=>{
    const url=new URL(input),body=options.body?JSON.parse(options.body):null;
    if(url.pathname==='/rest/v1/reader_documents'){
      const key=url.searchParams.get('key').slice(3),row=rows.get(key);return Response.json(row?[structuredClone(row)]:[]);
    }
    if(url.pathname==='/rest/v1/rpc/reader_document_cas'){
      const {document_key:key,expected_version:version,document_value:value}=body,old=rows.get(key),saved=(old?.version||0)===version;
      if(saved)rows.set(key,{version:version+1,value:structuredClone(value)});return Response.json(saved);
    }
    if(!url.pathname.startsWith('/auth/v1/'))throw Error('Unexpected fixture boundary');
    calls.push({url,body,options});
    const custom=await onProvider?.({url,body,options,user,providerSession,calls,rows});if(custom!==undefined)return custom;
    if(url.pathname.endsWith('/settings'))return Response.json({external:{email:true,google:true,apple:false},disable_signup:false,mailer_autoconfirm:false});
    if(url.pathname.endsWith('/otp'))return Response.json({});
    if(url.pathname.endsWith('/verify')||url.pathname.endsWith('/token'))return Response.json(providerSession());
    if(url.pathname.endsWith('/user'))return Response.json(user);
    if(url.pathname.endsWith('/logout'))return new Response(null,{status:204});
    throw Error('Unexpected auth boundary');
  };
  return {env,rows,calls,fetcher,user,store:()=>createHostedStore({env,fetcher})};
}
