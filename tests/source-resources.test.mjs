import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceResourceHref,sourceResourcesNode,applySourceFormat} from '../app/source-resources.mjs';
import {pageKeyDirection} from '../app/reader-page-inputs.mjs';

const document={createElement(tag){return {tagName:tag.toUpperCase(),children:[],classList:{values:[],add(value){this.values.push(value);}},setAttribute(key,value){this[key]=String(value);},append(...children){this.children.push(...children);}};}};
test('original-resource links are same-origin book assets, never executable or tracking URLs',()=>{
 assert.equal(sourceResourceHref('/book-assets/pg-2009-diagram.jpg','https://reader.example/read'),'https://reader.example/book-assets/pg-2009-diagram.jpg');
 for(const url of ['javascript:alert(1)','data:text/html,unsafe','https://other.example/book-assets/a.png','//other.example/a.png','/book-assets/../api/private','/api/account','/book-assets/a.png?token=private'])assert.equal(sourceResourceHref(url,'https://reader.example/read'),null,url);
});
test('source-resource controls are separate from author text and use inert captions',()=>{
 const node=sourceResourcesNode(document,[{url:'/book-assets/a.png',title:'<Original diagram>'},{url:'javascript:bad',title:'bad'}],'https://reader.example/read');
 assert.equal(node.tagName,'DIV');assert.equal(node.children.length,1);const link=node.children[0];assert.equal(link.tagName,'A');assert.equal(link.textContent,'<Original diagram>');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');assert.equal(node['data-reading-layer'],undefined);
 assert.equal(sourceResourcesNode(document,[],'https://reader.example/read'),null);
});
test('numeric tables keep keyboard arrows for native horizontal scrolling',()=>{
 const p=document.createElement('p');applySourceFormat(p,{kind:'original',preformatted:true});assert.ok(p.classList.values.includes('source-preformatted'));assert.equal(p.tabIndex,0);
 const event={key:'ArrowRight',target:{closest:selector=>selector.includes('.source-preformatted')?p:null}};assert.equal(pageKeyDirection(event),0);
});
