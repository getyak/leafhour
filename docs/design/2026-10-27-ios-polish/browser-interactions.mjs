// Shared verification gestures. These use visible edge controls or the real
// keyboard selection menu; no invisible paragraph buttons are added to the app.
export async function finishPanel(p){
 const s=await p.evaluate(()=>window.leafhourPrototype.snapshot());
 if(s.route!=='closed')await p.locator('#sheet-done').click();
 if(await p.locator('#reader-sheet').isVisible())await p.locator('#reader-sheet').waitFor({state:'hidden'});
}
export async function openNavigation(p){await finishPanel(p);await p.locator('#wake-top').click();}
export async function openProgress(p){await finishPanel(p);await p.locator('#wake-bottom').click();}
export async function openCompanion(p){await openProgress(p);await p.locator('#companion-button').click();await p.locator('#reader-sheet[data-motion="settled"]').waitFor();}
export async function choosePassage(p,id){
 if(await p.locator('#reading-scroll').evaluate(n=>n.inert)){
  await p.locator('#sheet-grip').press('Enter');await p.locator('#reader-sheet[data-motion="settled"]').waitFor();
 }
 const span=p.locator('#'+id+' .passage-text');await span.scrollIntoViewIfNeeded();await p.locator('#reading-scroll').focus();
 await span.evaluate(n=>{const r=document.createRange();r.selectNodeContents(n);const s=getSelection();s.removeAllRanges();s.addRange(r);});
 await p.keyboard.press('Shift+F10');await p.locator('#selection-menu').waitFor();
}
