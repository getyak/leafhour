const absolutePath=value=>typeof value==='string'&&(/^(?:\/|[A-Za-z]:[\\/])/.test(value))&&!value.includes('\0');
export function makeMcpConfiguration(setup,token){
  if(setup?.hosted){
    let remote;try{remote=new URL(setup.serviceUrl);}catch{throw Error('线上书房地址无效。');}
    if(remote.protocol!=='https:'||remote.username||remote.password||remote.pathname!=='/'||remote.search||remote.hash)throw Error('线上配置需要完整的 HTTPS 书房地址。');
    if(typeof token!=='string'||!token.trim())throw Error('请先创建仍有效的授权。');
    return {mcpServers:{marginalia:{command:'npx',args:['--yes','--package=git+https://github.com/getyak/marginalia-reader.git#v0.2.0','marginalia-mcp'],env:{READER_SERVICE_URL:remote.origin,READER_AGENT_TOKEN:token,READER_ALLOW_REMOTE:'true'}}}};
  }
  if(!absolutePath(setup?.command)||!Array.isArray(setup.args)||setup.args.length!==1||!absolutePath(setup.args[0]))throw Error('本机启动路径尚未准备好，请重新读取配置。');
  let base;try{base=new URL(setup.serviceUrl);}catch{throw Error('本机服务地址无效。');}
  if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('此配置只连接这台电脑上的旁读服务。');
  if(typeof token!=='string'||!token.trim())throw Error('请先创建仍有效的授权。');
  return {mcpServers:{marginalia:{command:setup.command,args:[...setup.args],env:{READER_SERVICE_URL:base.origin,READER_AGENT_TOKEN:token}}}};
}
