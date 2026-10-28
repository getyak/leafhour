import test from 'node:test';
import assert from 'node:assert/strict';
import {enterAutoHome} from '../app/home-entry.mjs';
test('a server-resolved home entry keeps its first language without another account lookup',async()=>{
 const attributes={'data-ui-initial-locale':'ja','data-ui-initial-source':'account','data-ui-initial-preference':'ja','data-ui-initial-owner':'owner-a'};
 const targets=[],location={href:'https://leafhour.test/?book=literal%2Fid#source',replace:value=>targets.push(value)};
 const view={document:{documentElement:{getAttribute:key=>attributes[key]??null,hasAttribute:()=>false}}};
 const result=await enterAutoHome({location,view,request(){assert.fail('server already verified the selection');},storage:{getItem(){assert.fail('do not create another choice');}},languages:['en']});
 assert.equal(result.locale,'ja');assert.equal(targets[0],'/ja?book=literal%2Fid#source');
});
