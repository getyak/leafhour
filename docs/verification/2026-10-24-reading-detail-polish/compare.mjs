// Compare two capture audits: prints metric deltas and hit-area regressions so
// each polish iteration keeps numeric before/after evidence.
// Usage: node compare.mjs <before-audit.json> <after-audit.json>
import {readFile} from 'node:fs/promises';
const [beforePath,afterPath]=process.argv.slice(2);
if(!beforePath||!afterPath)throw Error('compare.mjs <before-audit.json> <after-audit.json>');
const before=JSON.parse(await readFile(beforePath,'utf8')),after=JSON.parse(await readFile(afterPath,'utf8'));
const round=n=>Math.round(n*10)/10;
for(const [i,bv] of before.viewports.entries()){
  const av=after.viewports[i];
  if(!av||av.width!==bv.width){console.log(`viewport ${bv.width}: missing in after`);continue;}
  console.log(`\n=== viewport ${bv.width}×${bv.height}`);
  for(const [state,bm] of Object.entries(bv.metrics)){
    const am=av.metrics?.[state];
    if(!am)continue;
    const lines=[];
    for(const [sel,base] of Object.entries(bm)){
      const now=am[sel];
      if(!base&&!now)continue;
      if(base&&!now){lines.push(`  - ${sel} removed`);continue;}
      if(!base&&now){lines.push(`  + ${sel} added ${now.w}×${now.h} @${now.x},${now.y}`);continue;}
      const deltas=[];
      for(const key of ['x','y','w','h'])if(round(now[key]-base[key])!==0)deltas.push(`${key} ${base[key]}→${now[key]}`);
      for(const key of ['mt','mb','pt','pb','gap','font','line'])if(now[key]!==base[key])deltas.push(`${key} ${base[key]}→${now[key]}`);
      if(deltas.length)lines.push(`  ~ ${sel}: ${deltas.join(', ')}`);
    }
    const beforeSmall=(bv.controls[state]||[]).filter(r=>r.visible&&(r.w<44||r.h<44)).map(r=>`${r.id||r.text}: ${r.w}×${r.h}`);
    const afterSmall=(av.controls?.[state]||[]).filter(r=>r.visible&&(r.w<44||r.h<44)).map(r=>`${r.id||r.text}: ${r.w}×${r.h}`);
    const fixed=beforeSmall.filter(r=>!afterSmall.includes(r)),broken=afterSmall.filter(r=>!beforeSmall.includes(r));
    for(const r of fixed)lines.push(`  ✓ hit area now ≥44: ${r}`);
    for(const r of broken)lines.push(`  ✗ hit area under 44: ${r}`);
    if(lines.length){console.log(`-- ${state}`);for(const l of lines)console.log(l);}
  }
}
