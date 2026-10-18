// Synthetic SDK protocol peer, never a provider or real account.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
const server=new McpServer({name:'daily-host-synthetic',version:'1.0.0'});
server.registerTool('reader_daily_claim',{inputSchema:{bookId:z.string(),mode:z.string().optional()}},async({mode})=>{
 if(mode==='error')return {isError:true,content:[{type:'text',text:process.env.READER_AGENT_TOKEN}]};
 const data=mode==='echo'?{token:process.env.READER_AGENT_TOKEN}:mode==='oversize'?{text:'x'.repeat(65537)}:{status:'quiet',tokenPresent:!!process.env.READER_AGENT_TOKEN,unrelatedKeyPresent:!!process.env.OPENAI_API_KEY};
 return {structuredContent:data,content:[{type:'text',text:JSON.stringify(data)}]};
});
console.error(process.env.READER_AGENT_TOKEN); // exercise stderr containment with a synthetic token
await server.connect(new StdioServerTransport());
