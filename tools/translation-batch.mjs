#!/usr/bin/env node
// Explicit, bounded translation batches over the existing authenticated
// Leafhour HTTP API (GET-151). Dry-run by default; actual generation needs
// --execute and an explicit --max-requests in 1..20. The session is read only
// from the LEAFHOUR_SESSION environment variable; passwords and token
// arguments are never accepted. Nothing here schedules work or extends any
// provider budget: requests stay serial and every result remains a draft.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseBatchArgs,defaultCheckpointPath,runBatch,BatchError,SESSION_ENV,MAX_BATCH_REQUESTS} from './lib/translation-batch.mjs';

export const USAGE=[
  '用法：node tools/translation-batch.mjs --origin <https://leafhour.com> --book <bookId> [--checkpoint <path>] [--execute --max-requests <1..'+MAX_BATCH_REQUESTS+'>]',
  '默认是演练（dry-run）：只读取书籍并打印计划，不写检查点、不占用额度、不生成译文。',
  '实际生成必须同时给出 --execute 与 --max-requests 1..'+MAX_BATCH_REQUESTS+'；串行请求，单次最多 '+MAX_BATCH_REQUESTS+' 段，其余请再次执行续跑。',
  '会话只从环境变量 '+SESSION_ENV+' 读取（已登录的浏览器会话）；不接受密码、也不接受命令行令牌。',
  '检查点默认写在 local/translation-batches/<bookId>.json（0700 目录 / 0600 文件），只含稳定 ID 与原因码，不含令牌、原文、译文或个人记录。',
  '所有结果均为 draft 草稿；术语一致性、人工复核与来源页校对是另外的质量门。全书内容与人工复核并未因本工具自动完成。'
].join('\n');

function printSummary(summary,write){
  const counts=summary.counts||{};
  write('翻译批次（'+(summary.mode==='dry-run'?'演练 dry-run':'执行 execute')+'）· book '+summary.bookId+' · source '+summary.contentVersion);
  write('可生成 '+(counts.eligible||0)+' · 部分译文 '+(counts.partial||0)+' · 已复核 '+(counts.reviewed||0)+' · 已完整 '+(counts.complete||0)+' · 其他排除 '+(['front-matter','appendix','metadata','chinese-source','excluded-chapter'].reduce((n,key)=>n+(counts[key]||0),0)));
  for(const row of summary.skipped)write('跳过 '+row.id+'（'+row.reason+'）');
  if(summary.mode==='dry-run'){
    write('计划顺序：'+(summary.eligible.join(' ')||'（没有待生成段落）'));
    write('未发出请求，也未写检查点。加入 --execute --max-requests N 才会实际生成。');
    return;
  }
  write('请求 '+summary.requests+' / '+summary.maxRequests+' · 本次已保存 '+summary.entries.filter(e=>e.state==='saved').length+' · 仍待生成 '+summary.remaining);
  if(summary.checkpoint)write('检查点：'+summary.checkpoint);
  for(const entry of summary.entries)write((entry.state==='saved'?'已保存 ':'已记录 ')+entry.id+(entry.reason?'（'+entry.reason+'）':''));
  if(summary.stopped==='limit')write('已达到本次请求上限；再次执行会从检查点继续。');
  else if(summary.stopped==='failure'||summary.stopped==='unknown')write('已在第一个失败处停止，没有自动重试；再次执行会重试该段，并按服务器实际译文对账。');
  else if(summary.stopped==='aborted')write('已停止发出后续请求；正在进行的请求按实际结果记录，不声称已撤销或退款。');
  else if(summary.stopped==='source-changed')write('原文版本已变化，本次停止；请核对新来源后使用新的检查点。');
  write('结果均为 draft 草稿；术语一致性、人工复核与来源页校对是另外的质量门。实际全书内容与人工复核仍未完成。');
}

export async function main({argv=process.argv.slice(2),env=process.env,write=console.log,writeError=console.error,signal=null}={}){
  let options;
  try{options=parseBatchArgs(argv);}
  catch(e){writeError('参数不正确：'+(e instanceof BatchError?e.message:'无法解析参数')); writeError(USAGE);return 2;}
  if(options.help){write(USAGE);return 0;}
  const session=env[SESSION_ENV];
  if(typeof session!=='string'||!session){writeError('缺少环境变量 '+SESSION_ENV+'：请从已登录的浏览器会话取得；本工具不接受密码或命令行令牌。');return 2;}
  try{
    const summary=await runBatch({origin:options.origin,bookId:options.bookId,session,execute:options.execute,maxRequests:options.maxRequests,checkpointFile:options.checkpoint||defaultCheckpointPath(options.bookId),signal});
    printSummary(summary,write);
    return summary.mode==='execute'&&summary.stopped&&summary.stopped!=='limit'?1:0;
  }catch(e){
    if(e instanceof BatchError&&e.usage){writeError(e.message);writeError(USAGE);return 2;}
    writeError('批处理未完成：'+(e instanceof BatchError?e.message:'发生未预期的本机错误；未输出可能包含私密信息的异常详情'));
    return 1;
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const controller=new AbortController();
  process.on('SIGINT',()=>{controller.abort();});
  process.exitCode=await main({signal:controller.signal});
}
