import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {sourceDescriptionMessages,importSourceDescription} from '../app/document-source.mjs';
import {createTranslationState,createTranslationPresentation} from '../app/translation-state.mjs';
const compile=async(file,entry)=>{const result=await build({stdin:{contents:`import {${entry}} from ${JSON.stringify(fileURLToPath(new URL(file,import.meta.url)))};globalThis.entry=${entry};`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'js'},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,charset:'utf8',write:false,logLevel:'silent',plugins:[{name:'actual-ui-runtime-external-edge',setup(builder){builder.onResolve({filter:/^\.\/ui-locale\.mjs$/},args=>args.importer===fileURLToPath(new URL(file,import.meta.url))?{path:'/ui-locale.mjs',external:true}:undefined);}}]});return result.outputFiles[0].text;};
test('descriptor-only source UI does not retain unused legacy prose while legacy helper stays compatible',async()=>{
 const compiled=await compile('../app/document-source.mjs','sourceDescriptionMessages');assert.ok(compiled.includes('source.description.epub'));assert.ok(!compiled.includes('EPUB 原文保留在自己的书房'));assert.ok(importSourceDescription({source:{format:'epub',structure:'epub_navigation'}}).includes('EPUB 原文保留在自己的书房'));assert.ok(sourceDescriptionMessages({source:{format:'epub'}}).includes('source.description.epub'));
});
test('descriptor-only translation UI excludes unused legacy prose and retains the legacy entry',async()=>{
 const compiled=await compile('../app/translation-state.mjs','createTranslationPresentation');assert.ok(compiled.includes('translation.backgroundRunning'));assert.ok(!compiled.includes('另一段正在翻译，可以继续阅读。'));assert.equal(typeof createTranslationState().view,'function');assert.equal(typeof createTranslationPresentation().view,'function');
});
test('pure owned-link codec import excludes navigator aliases and authored-route tables that it never uses',async()=>{
 const compiled=await compile('../app/ui-locale-codec.mjs','withUiParam');assert.ok(!compiled.includes('zh-sg'));assert.ok(!compiled.includes('/ja/privacy'));const {withUiParam}=await import('../app/ui-locale-codec.mjs');assert.equal(withUiParam('/read?book=literal#p1','ja'),'/read?book=literal&ui=ja#p1');
});
test('parallel settings use canonical style IDs without retaining legacy presentation prose',async()=>{
 const compiled=await compile('../app/parallel-reading.mjs','applyParallelAppearance');assert.ok(!compiled.includes('原文与译文同等清晰'));assert.ok(!compiled.includes('素面对照'));const {parallelStyles}=await import('../app/parallel-reading.mjs');assert.equal(parallelStyles.length,5);assert.equal(parallelStyles[0].name,'素面对照');
});
