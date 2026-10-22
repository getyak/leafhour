import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createLockedJsonStore} from './locked-json-store.mjs';

export function billingError(code,status=400){return Object.assign(new Error(code),{code,status});}
const fail=(code,status=400)=>{throw billingError(code,status);};
const integer=(n,min=0)=>{if(!Number.isSafeInteger(n)||n<min)fail('invalid_input');return n;};
const identifier=value=>{if(typeof value!=='string'||!value||value.length>200)fail('invalid_input');return value;};
const blank=()=>({accounts:{},quotes:{},operations:{},keys:{},orders:{},intents:{},events:{},providerOrders:{},entries:[],calls:{},refunds:{},subscriptions:{},transactions:{},periods:{}});
const compound=(...keys)=>JSON.stringify(keys);
const sum=(rows,key)=>rows.reduce((n,row)=>n+(row[key]||0),0);
const publicOperation=op=>structuredClone(op);
const timestamp=value=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail('invalid_input');return new Date(value).toISOString();};
const subscriptionStatuses=new Set(['active','trialing','past_due','unpaid','paused','scheduled_cancel','canceled','expired','incomplete']);
// Creem can retry expired subscriptions; only confirmed cancellation ends renewal.
const terminalSubscriptionStatuses=new Set(['canceled']);

// A transactional reference for isolated tests and local restart verification.
// Even when persisted on disk it is deliberately NOT a production accounting store.
export function createBillingMemoryStore({dataDir,clock=Date.now}={}){
  const disk=dataDir?createLockedJsonStore({dataDir,busyMessage:'billing_store_busy'}):null;
  const states=new Map();let tail=Promise.resolve();
  async function command(action,payload={}){
    const p=structuredClone(payload);if(!['test','live'].includes(p.mode))fail('invalid_mode');
    const execute=state=>{
      const s={...blank(),...structuredClone(state)},now=p.now||new Date(clock()).toISOString();
      if(!Number.isFinite(Date.parse(now)))fail('invalid_input');
      const ownerId=['summary','readiness','lookupOrder','lookupSubscription'].includes(action)?null:identifier(p.ownerId);
      const account=()=>s.accounts[ownerId]??=( {ownerId,lots:[],frozen:false,trialGranted:false} );
      const findOrder=()=>{const o=s.orders[identifier(p.orderId)];if(!o||o.ownerId!==ownerId)fail('not_found',404);return o;};
      const findOp=()=>{const o=s.operations[identifier(p.operationId)];if(!o||o.ownerId!==ownerId)fail('not_found',404);return o;};
      const addEntry=(type,units,extra={})=>s.entries.push({id:randomUUID(),ownerId,mode:p.mode,type,units,createdAt:now,...extra});
      const balance=(a=account())=>({availableUnits:sum(a.lots,'available'),reservedUnits:sum(a.lots,'reserved'),grantedUnits:sum(a.lots,'granted'),consumedUnits:Math.max(0,-sum(s.entries.filter(e=>e.ownerId===(a.ownerId||ownerId)&&['consume','reverse'].includes(e.type)),'units')),trialGranted:a.trialGranted,frozen:a.frozen,sources:['trial','purchase','review'].map(source=>({source,availableUnits:sum(a.lots.filter(l=>l.source===source),'available'),reservedUnits:sum(a.lots.filter(l=>l.source===source),'reserved')}))});
      const event=()=>{
        const id=identifier(p.eventId),hash=identifier(p.eventHash),prior=s.events[id],eventAction=action==='subscriptionPaid'?'payment':action;
        if(prior){if(prior.hash!==hash||prior.orderId!==p.orderId||prior.action&&prior.action!==eventAction)fail('event_conflict',409);return true;}
        s.events[id]={hash,orderId:p.orderId,action:eventAction,createdAt:now};return false;
      };
      const fence=op=>{if(op.reservationToken!==p.reservationToken)fail('stale_worker',409);};
      const release=op=>{for(const part of op.allocations){const lot=account().lots.find(l=>l.id===part.lotId);lot.reserved-=part.units;lot.available+=part.units;}op.updatedAt=now;};
      const revoke=(o,target)=>{
        target=Math.min(o.units,Math.max(o.revokedUnits||0,integer(target)));const delta=target-(o.revokedUnits||0);o.revokedUnits=target;
        if(!delta)return;
        const a=account(),lot=a.lots.find(l=>l.orderId===o.id);
        if(lot){
          // A revoked hold loses its fencing permission before its funds are reclaimed.
          for(const op of Object.values(s.operations))if(op.ownerId===ownerId&&['reserved','running','result_saved'].includes(op.status)&&op.allocations.some(x=>x.lotId===lot.id)){
            release(op);op.status='released';op.reason='payment_revoked';op.reservationToken=randomUUID();addEntry('release',0,{operationId:op.id,reason:op.reason});
          }
          const removed=Math.min(lot.available,delta);lot.available-=removed;lot.revoked+=delta;
          if(removed<delta){a.frozen=true;o.exposureUnits=(o.exposureUnits||0)+delta-removed;}
          addEntry('refund',-removed,{orderId:o.id,source:lot.source});
        }
      };
      let result;
      switch(action){
        case 'readiness':result={ready:false,durable:false,schemaVersion:2,backend:'reference'};break;
        case 'lookupSubscription':result=s.subscriptions[identifier(p.subscriptionId)]||null;break;
        case 'subscriptions':result={subscriptions:Object.values(s.subscriptions).filter(x=>x.ownerId===ownerId).reverse()};break;
        case 'bindSubscription':case 'subscriptionState':{
          const subscriptionId=identifier(p.subscriptionId),customerId=identifier(p.customerId),status=identifier(p.status);
          if(!subscriptionStatuses.has(status))fail('invalid_input');
          const currentPeriodStart=timestamp(p.currentPeriodStart),currentPeriodEnd=timestamp(p.currentPeriodEnd),supplierUpdatedAt=timestamp(p.supplierUpdatedAt);
          if(Date.parse(currentPeriodEnd)<=Date.parse(currentPeriodStart))fail('invalid_input');
          let sub=s.subscriptions[subscriptionId];
          if(sub&&sub.ownerId!==ownerId)fail('owner_mismatch',403);
          if(!sub&&action==='subscriptionState')fail('not_found',404);
          if(action==='bindSubscription'){
            const o=findOrder();if(o.productKey!=='reading_monthly_100'||p.productKey!==o.productKey||p.productId!==o.productId)fail('payment_mismatch',409);
            if(sub&&(sub.initialOrderId!==o.id||sub.productId!==p.productId))fail('payment_mismatch',409);
            if(o.subscriptionId&&o.subscriptionId!==subscriptionId)fail('payment_mismatch',409);
            if(!sub&&Object.values(s.subscriptions).some(x=>x.ownerId===ownerId&&!terminalSubscriptionStatuses.has(x.status)))fail('subscription_exists',409);
            if(p.providerOrderId!==undefined){
              const providerOrderId=identifier(p.providerOrderId),bound=s.providerOrders[providerOrderId];
              if(o.providerOrderId&&o.providerOrderId!==providerOrderId||bound&&bound!==o.id||sub?.initialProviderOrderId&&sub.initialProviderOrderId!==providerOrderId)fail('payment_mismatch',409);
              s.providerOrders[providerOrderId]=o.id;o.providerOrderId=providerOrderId;
            }
            if(!sub)sub=s.subscriptions[subscriptionId]={subscriptionId,ownerId,mode:p.mode,customerId,initialOrderId:o.id,productId:o.productId,productKey:o.productKey,createdAt:now};
            if(p.providerOrderId!==undefined)sub.initialProviderOrderId=p.providerOrderId;
            o.subscriptionId=subscriptionId;
          }
          if(sub.customerId!==customerId)fail('payment_mismatch',409);
          const snapshot={status,currentPeriodStart,currentPeriodEnd,supplierUpdatedAt};
          if(sub.supplierUpdatedAt&&Date.parse(supplierUpdatedAt)<Date.parse(sub.supplierUpdatedAt)){result=sub;break;}
          if(sub.supplierUpdatedAt===supplierUpdatedAt&&Object.keys(snapshot).some(k=>snapshot[k]!==sub[k]))fail('idempotency_conflict',409);
          if(!terminalSubscriptionStatuses.has(status)&&Object.values(s.subscriptions).some(x=>x.subscriptionId!==subscriptionId&&x.ownerId===ownerId&&!terminalSubscriptionStatuses.has(x.status)))fail('subscription_exists',409);
          Object.assign(sub,snapshot,{updatedAt:now});result=sub;break;
        }
        case 'lookupOrder':{
          if(!p.providerOrderId&&!p.checkoutId)fail('invalid_input');
          result=Object.values(s.orders).find(o=>(!p.providerOrderId||o.providerOrderId===p.providerOrderId)&&(!p.checkoutId||o.checkoutId===p.checkoutId))||null;break;
        }
        case 'account':result=balance(s.accounts[ownerId]||{lots:[],trialGranted:false,frozen:false});break;
        case 'trial':{
          identifier(p.grantId);integer(p.units,1);const a=account();
          if(!a.trialGranted&&p.campaignBudgetUnits!==undefined){integer(p.campaignBudgetUnits);const total=sum(s.entries.filter(e=>e.type==='grant'&&e.source==='trial'),'units');if(total+p.units>p.campaignBudgetUnits)fail('trial_budget_exhausted',503);}
          if(!a.trialGranted){a.trialGranted=true;a.lots.push({id:p.grantId,source:'trial',available:p.units,reserved:0,granted:p.units,consumed:0,revoked:0,createdAt:now});addEntry('grant',p.units,{source:'trial'});}result=balance();break;
        }
        case 'quote':{
          identifier(p.id);integer(p.units,1);identifier(p.scopeHash);identifier(p.action);identifier(p.priceVersion);
          if(!p.scope||typeof p.scope!=='object'||JSON.stringify(p.scope).length>4096||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=Date.parse(now))fail('invalid_input');
          const prior=s.quotes[p.id];if(prior){if(['ownerId','mode','action','units','scopeHash','priceVersion','expiresAt'].some(k=>prior[k]!==p[k])||!isDeepStrictEqual(prior.scope,p.scope))fail('idempotency_conflict',409);result=prior;break;}
          result=s.quotes[p.id]={id:p.id,ownerId,mode:p.mode,action:p.action,units:p.units,scopeHash:p.scopeHash,scope:p.scope,priceVersion:p.priceVersion,expiresAt:p.expiresAt,createdAt:now};break;
        }
        case 'reserve':{
          identifier(p.idempotencyKey);identifier(p.operationId);identifier(p.scopeHash);
          const key=compound(ownerId,p.idempotencyKey),prior=s.operations[s.keys[key]];
          if(prior){if(prior.scopeHash!==p.scopeHash||prior.quoteId!==p.quoteId)fail('idempotency_conflict',409);result=publicOperation(prior);break;}
          const q=s.quotes[p.quoteId];if(!q||q.ownerId!==ownerId)fail('not_found',404);
          if(Object.values(s.operations).some(o=>o.quoteId===q.id))fail('quote_already_used',409);
          if(q.scopeHash!==p.scopeHash)fail('quote_changed',409);if(Date.parse(q.expiresAt)<=Date.parse(now))fail('stale_quote',409);
          const a=account();if(a.frozen)fail('frozen_account',403);if(balance().availableUnits<q.units)fail('insufficient_credits',402);
          if(s.operations[p.operationId])fail('idempotency_conflict',409);
          let remaining=q.units;const allocations=[];
          for(const lot of [...a.lots].sort((x,y)=>(x.source==='trial'?0:1)-(y.source==='trial'?0:1)||x.createdAt.localeCompare(y.createdAt))){const take=Math.min(remaining,lot.available);if(take){lot.available-=take;lot.reserved+=take;allocations.push({lotId:lot.id,units:take});remaining-=take;}if(!remaining)break;}
          const op={id:p.operationId,ownerId,mode:p.mode,quoteId:q.id,idempotencyKey:p.idempotencyKey,action:q.action,units:q.units,scopeHash:q.scopeHash,scope:q.scope,status:'reserved',reservationToken:randomUUID(),allocations,createdAt:now,updatedAt:now};
          s.operations[op.id]=op;s.keys[key]=op.id;addEntry('hold',0,{operationId:op.id,reservedUnits:q.units});result=publicOperation(op);break;
        }
        case 'operation':{const op=s.operations[p.operationId];result=op?.ownerId===ownerId?publicOperation(op):null;break;}
        case 'running':{const op=findOp();fence(op);const executionClaimed=op.status==='reserved';if(executionClaimed){op.status='running';op.startedAt=now;op.updatedAt=now;}else if(op.status!=='running')fail('invalid_state',409);result={...publicOperation(op),executionClaimed};break;}
        case 'result':{
          const op=findOp();fence(op);if(!['reserved','running','result_saved'].includes(op.status))fail('invalid_state',409);
          const receipt=p.receipt;if(!receipt||receipt.ownerId!==ownerId||receipt.bookId!==op.scope.bookId||receipt.sourceVersion!==op.scope.sourceVersion||receipt.contentVersion!==op.scope.contentVersion||typeof receipt.resultId!=='string'||!receipt.resultId||JSON.stringify(receipt).length>4096)fail('invalid_receipt');
          // Whitelist references only; content belongs in its existing owner-bound store.
          const clean=Object.fromEntries(['ownerId','bookId','sourceVersion','contentVersion','passageId','resultId','kind','operationId'].filter(k=>receipt[k]!==undefined).map(k=>[k,identifier(receipt[k])]));
          if(op.receipt&&JSON.stringify(op.receipt)!==JSON.stringify(clean))fail('idempotency_conflict',409);op.receipt=clean;op.status='result_saved';op.outbox={status:'pending',resultId:clean.resultId};op.updatedAt=now;result=publicOperation(op);break;
        }
        case 'settle':{
          const op=findOp();fence(op);if(['settled','reversed'].includes(op.status)){result=publicOperation(op);break;}if(op.status!=='result_saved')fail('invalid_state',409);if(account().frozen)fail('frozen_account',403);
          const unitsBySource={trial:0,purchase:0,review:0};for(const part of op.allocations){const lot=account().lots.find(l=>l.id===part.lotId);lot.reserved-=part.units;lot.consumed+=part.units;unitsBySource[lot.source]=(unitsBySource[lot.source]||0)+part.units;}
          op.status='settled';op.settledAt=now;op.updatedAt=now;addEntry('consume',-op.units,{operationId:op.id,action:op.action,unitsBySource});result=publicOperation(op);break;
        }
        case 'release':{
          const op=findOp();fence(op);if(p.expectedStatus&&op.status!==p.expectedStatus){result=publicOperation(op);break;}if(['released','cancelled'].includes(op.status)){result=publicOperation(op);break;}if(['settled','reversed'].includes(op.status)){result=publicOperation(op);break;}
          release(op);op.status=p.reason==='cancelled'?'cancelled':'released';op.reason=String(p.reason||'failed').slice(0,80);op.outbox=null;addEntry('release',0,{operationId:op.id,reason:op.reason,reservedUnits:-op.units});result=publicOperation(op);break;
        }
        case 'reverse':{
          const op=findOp();if(op.status==='reversed'){result=publicOperation(op);break;}if(op.status!=='settled')fail('invalid_state',409);
          let restored=0;const unitsBySource={trial:0,purchase:0,review:0};for(const part of op.allocations){const lot=account().lots.find(l=>l.id===part.lotId);lot.consumed-=part.units;const restore=Math.min(part.units,Math.max(0,lot.granted-lot.revoked-lot.consumed-lot.available-lot.reserved));lot.available+=restore;restored+=restore;unitsBySource[lot.source]=(unitsBySource[lot.source]||0)+part.units;
            if(lot.orderId){const order=s.orders[lot.orderId];order.exposureUnits=Math.max(0,(order.exposureUnits||0)-(part.units-restore));}
          }
          account().frozen=Object.values(s.orders).some(o=>o.ownerId===ownerId&&(o.disputed||o.exposureUnits>0));
          op.status='reversed';op.reason=String(p.reason||'undeliverable').slice(0,80);op.updatedAt=now;op.outbox=null;addEntry('reverse',op.units,{operationId:op.id,restoredUnits:restored,unitsBySource});result=publicOperation(op);break;
        }
        case 'order':{
          identifier(p.id);identifier(p.intentKey);identifier(p.productId);identifier(p.productKey);integer(p.amount);integer(p.units,1);if(!/^[A-Z]{3}$/.test(p.currency))fail('invalid_input');
          const key=compound(ownerId,p.intentKey),prior=s.orders[s.intents[key]];
          if(prior){if(['productKey','productId','amount','currency','units'].some(k=>prior[k]!==p[k]))fail('idempotency_conflict',409);result=prior;break;}
          if(p.productKey==='reading_monthly_100'&&(Object.values(s.subscriptions).some(x=>x.ownerId===ownerId&&!terminalSubscriptionStatuses.has(x.status))||Object.values(s.orders).some(o=>o.ownerId===ownerId&&o.productKey==='reading_monthly_100'&&o.status!=='expired'&&(!o.subscriptionId||!terminalSubscriptionStatuses.has(s.subscriptions[o.subscriptionId]?.status)))))fail('subscription_exists',409);
          if(s.orders[p.id])fail('idempotency_conflict',409);
          result=s.orders[p.id]={id:p.id,ownerId,mode:p.mode,intentKey:p.intentKey,productKey:p.productKey,productId:p.productId,amount:p.amount,currency:p.currency,units:p.units,status:'pending',paymentVerified:false,revokedUnits:0,refundedAmount:0,createdAt:now,updatedAt:now};s.intents[key]=p.id;break;
        }
        case 'checkout':{
          const o=findOrder();identifier(p.checkoutId);if(p.checkoutUrl!==undefined&&p.checkoutUrl!==null)identifier(p.checkoutUrl);if(o.checkoutId&&o.checkoutId!==p.checkoutId)fail('idempotency_conflict',409);
          if(Object.values(s.orders).some(x=>x.id!==o.id&&x.checkoutId===p.checkoutId))fail('idempotency_conflict',409);
          o.checkoutId=p.checkoutId;if(p.checkoutUrl)o.checkoutUrl=p.checkoutUrl;o.updatedAt=now;result=o;break;
        }
        case 'checkoutAttempt':{const o=findOrder();const claimed=!o.checkoutAttemptedAt;if(claimed)o.checkoutAttemptedAt=now;result={claimed,order:o};break;}
        case 'expireCheckout':{
          const o=findOrder();identifier(p.checkoutId);
          if(!o.checkoutId)fail('invalid_state',409);if(o.checkoutId!==p.checkoutId)fail('payment_mismatch',409);
          if(!['pending','expired'].includes(o.status)||o.paymentVerified||o.subscriptionId||Object.values(s.subscriptions).some(x=>x.initialOrderId===o.id))fail('invalid_state',409);
          if(o.status!=='expired'){o.status='expired';o.updatedAt=now;}result=o;break;
        }
        case 'getOrder':{const o=s.orders[p.orderId];result=o?.ownerId===ownerId?o:null;break;}
        case 'subscriptionPaid':case 'payment':{
          if(action==='subscriptionPaid'){
            const subscriptionId=identifier(p.subscriptionId),transactionId=identifier(p.transactionId),sub=s.subscriptions[subscriptionId];
            if(!sub)fail('not_found',404);if(sub.ownerId!==ownerId)fail('owner_mismatch',403);if(identifier(p.customerId)!==sub.customerId)fail('payment_mismatch',409);
            p.periodStart=timestamp(p.periodStart);p.periodEnd=timestamp(p.periodEnd);if(Date.parse(p.periodEnd)<=Date.parse(p.periodStart))fail('invalid_input');
            identifier(p.providerOrderId);integer(p.paidAmount);integer(p.amount);integer(p.taxAmount);integer(p.discountAmount);integer(p.units,1);
            if(p.paidAmount<=0||p.paidAmount!==p.amount-p.discountAmount+p.taxAmount||p.discountAmount>p.amount)fail('payment_mismatch',409);
            const initial=s.orders[sub.initialOrderId];if(p.amount!==initial.amount||p.currency!==initial.currency||p.units!==initial.units)fail('payment_mismatch',409);
            const identity=Object.fromEntries(['subscriptionId','customerId','transactionId','providerOrderId','periodStart','periodEnd','amount','paidAmount','taxAmount','discountAmount','currency','units'].map(k=>[k,p[k]]));
            const previous=s.transactions[transactionId],periodKey=compound(subscriptionId,p.periodStart,p.periodEnd),period=s.periods[periodKey];
            if(previous&&!isDeepStrictEqual(previous.identity,identity)||period&&period!==transactionId)fail('payment_mismatch',409);
            if(previous){if(p.orderId&&p.orderId!==previous.orderId)fail('payment_mismatch',409);p.orderId=previous.orderId;}
            else if(p.orderId!==undefined){if(p.orderId!==sub.initialOrderId||initial.transactionId&&initial.transactionId!==transactionId||sub.initialProviderOrderId&&sub.initialProviderOrderId!==p.providerOrderId)fail('payment_mismatch',409);}
            else{
              if(sub.initialProviderOrderId===p.providerOrderId)fail('payment_mismatch',409);
              const id='subscription:'+createHash('sha256').update(p.mode+':'+transactionId).digest('hex');
              if(s.orders[id])fail('payment_mismatch',409);
              p.orderId=id;s.orders[id]={id,ownerId,mode:p.mode,intentKey:id,productKey:sub.productKey,productId:sub.productId,amount:p.amount,currency:p.currency,units:p.units,status:'pending',paymentVerified:false,revokedUnits:0,refundedAmount:0,createdAt:now,updatedAt:now};
            }
            const o=findOrder();if(o.providerOrderId&&o.providerOrderId!==p.providerOrderId)fail('payment_mismatch',409);
            if(o.id===sub.initialOrderId)sub.initialProviderOrderId??=p.providerOrderId;
            Object.assign(o,{subscriptionId,transactionId,periodStart:p.periodStart,periodEnd:p.periodEnd});
            s.transactions[transactionId]={orderId:o.id,identity};s.periods[periodKey]=transactionId;
            if(p.cumulativeRefundAmount!==undefined){integer(p.cumulativeRefundAmount);if(p.cumulativeRefundAmount>p.paidAmount)fail('payment_mismatch',409);const delta=Math.max(0,p.cumulativeRefundAmount-o.refundedAmount);if(delta){o.refundedAmount=p.cumulativeRefundAmount;addEntry('refund_cash',0,{orderId:o.id,amount:delta,currency:o.currency});}revoke(o,Math.ceil(o.units*o.refundedAmount/p.paidAmount));}
            if(p.disputed!==undefined&&typeof p.disputed!=='boolean')fail('invalid_input');if(p.disputed){o.disputed=true;account().frozen=true;revoke(o,o.units);}
            o.status=o.disputed?'disputed':o.revokedUnits>=o.units?'refunded':o.refundedAmount>0?'partially_refunded':o.paymentVerified?'paid':'pending';
            p.productId=o.productId;p.checkoutId=o.checkoutId;
          }
          const o=findOrder();if(event()){result=o;break;}
          if(p.checkoutId!==o.checkoutId||p.productId!==o.productId||p.amount!==o.amount||p.currency!==o.currency||p.units!==o.units)fail('payment_mismatch',409);
          integer(p.paidAmount);integer(p.taxAmount);integer(p.discountAmount);if(p.paidAmount!==o.amount-p.discountAmount+p.taxAmount||p.discountAmount>o.amount)fail('payment_mismatch',409);
          if(o.paidAmount!==undefined&&o.paidAmount!==p.paidAmount)fail('payment_mismatch',409);
          identifier(p.providerOrderId);const bound=s.providerOrders[p.providerOrderId];if(bound&&bound!==o.id)fail('payment_mismatch',409);s.providerOrders[p.providerOrderId]=o.id;
          if(o.paymentVerified){if(o.providerOrderId!==p.providerOrderId||o.paidAmount!==p.paidAmount||o.taxAmount!==p.taxAmount||o.discountAmount!==p.discountAmount)fail('payment_mismatch',409);o.status=o.disputed?'disputed':o.revokedUnits>=o.units?'refunded':o.refundedAmount>0?'partially_refunded':'paid';result=o;break;}
          Object.assign(o,{providerOrderId:p.providerOrderId,paymentVerified:true,paidAmount:p.paidAmount,taxAmount:p.taxAmount,discountAmount:p.discountAmount,paidAt:now,updatedAt:now});
          const units=Math.max(0,o.units-o.revokedUnits),source=p.paidAmount===0?'review':'purchase';
          addEntry('payment',0,{orderId:o.id,paidAmount:p.paidAmount,taxAmount:p.taxAmount,discountAmount:p.discountAmount,currency:o.currency,source});
          account().lots.push({id:'order:'+o.id,orderId:o.id,source,available:units,reserved:0,granted:units,consumed:0,revoked:0,createdAt:now});if(units)addEntry('grant',units,{orderId:o.id,source});
          o.status=o.disputed?'disputed':o.refundedAmount>0?(o.revokedUnits>=o.units?'refunded':'partially_refunded'):'paid';result=o;break;
        }
        case 'refund':{
          const o=findOrder();if(event()){result=o;break;}identifier(p.refundId);integer(p.refundAmount);integer(p.cumulativeRefundAmount);integer(p.paidAmount,1);
          if(p.cumulativeRefundAmount>p.paidAmount||p.refundAmount>p.paidAmount||(o.paidAmount!==undefined&&o.paidAmount!==p.paidAmount))fail('payment_mismatch',409);
          const key=compound(o.id,p.refundId),prior=s.refunds[key];if(prior&&prior!==p.refundAmount)fail('event_conflict',409);s.refunds[key]=p.refundAmount;
          o.paidAmount??=p.paidAmount;const previousRefund=o.refundedAmount;o.refundedAmount=Math.max(o.refundedAmount,p.cumulativeRefundAmount);if(o.refundedAmount>previousRefund)addEntry('refund_cash',0,{orderId:o.id,amount:o.refundedAmount-previousRefund,currency:o.currency});revoke(o,Math.ceil(o.units*o.refundedAmount/p.paidAmount));o.status=o.disputed?'disputed':o.revokedUnits>=o.units?'refunded':'partially_refunded';o.updatedAt=now;result=o;break;
        }
        case 'dispute':{const o=findOrder();if(event()){result=o;break;}o.disputed=true;o.status='disputed';account().frozen=true;revoke(o,o.units);o.updatedAt=now;result=o;break;}
        case 'entries':case 'orders':{
          const limit=p.limit===undefined?25:integer(p.limit,1);if(limit>100)fail('invalid_input');let offset=0;if(p.cursor!==undefined){if(!/^\d+$/.test(p.cursor))fail('invalid_input');offset=Number(p.cursor);if(!Number.isSafeInteger(offset))fail('invalid_input');}
          const rows=(action==='entries'?s.entries:Object.values(s.orders)).filter(x=>x.ownerId===ownerId).reverse(),key=action==='entries'?'entries':'orders';result={[key]:rows.slice(offset,offset+limit),nextCursor:offset+limit<rows.length?String(offset+limit):null};break;
        }
        case 'providerCall':{
          identifier(p.id);if(p.operationId&&s.operations[p.operationId]?.ownerId!==ownerId)fail('not_found',404);
          const clean=Object.fromEntries(['id','ownerId','operationId','feature','funding','provider','model','status','usage','costMicrousd','costStatus','startedAt','finishedAt','pricingVersion'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));
          for(const key of ['feature','funding','provider','model','status','costStatus'])identifier(clean[key]);if(clean.costMicrousd!==undefined&&clean.costMicrousd!==null)integer(clean.costMicrousd);if(clean.usage){clean.usage=Object.fromEntries(['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'].map(k=>[k,clean.usage[k]===null||clean.usage[k]===undefined?null:integer(clean.usage[k])]));}
          const prior=s.calls[p.id];
          if(prior&&!isDeepStrictEqual(prior,clean)){
            const sameIdentity=['id','ownerId','operationId','feature','funding','provider','model','startedAt'].every(k=>prior[k]===clean[k]);
            const open=prior.status==='unknown'&&prior.finishedAt===undefined&&prior.costStatus==='unknown'&&prior.costMicrousd===null&&Object.values(prior.usage||{}).every(v=>v===null);
            if(!sameIdentity||!open||!clean.finishedAt)fail('idempotency_conflict',409);
          }
          s.calls[p.id]=clean;result=clean;break;
        }
        case 'ackPublished':{const op=findOp();if(op.status!=='settled')fail('invalid_state',409);op.outbox={...op.outbox,status:'delivered'};op.publishedAt=now;op.updatedAt=now;result=publicOperation(op);break;}
        case 'recover':result={operations:Object.values(s.operations).filter(x=>x.ownerId===ownerId&&['reserved','running','result_saved','settled'].includes(x.status)&&x.outbox?.status!=='delivered').slice(0,100).map(publicOperation)};break;
        case 'summary':{
          const from=Date.parse(p.from),to=Date.parse(p.to);if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>366*86400000)fail('invalid_input');
          const inRange=t=>Date.parse(t)>=from&&Date.parse(t)<to,orders=Object.values(s.orders).filter(o=>inRange(o.createdAt)),calls=Object.values(s.calls).filter(c=>inRange(c.startedAt)),entries=s.entries.filter(e=>inRange(e.createdAt)),payments=entries.filter(e=>e.type==='payment'),paid=payments.filter(e=>e.paidAmount>0);
          const salesByCurrency={},refundsByCurrency={};for(const e of payments)salesByCurrency[e.currency]=(salesByCurrency[e.currency]||0)+e.paidAmount-e.taxAmount;for(const e of entries.filter(e=>e.type==='refund_cash'))refundsByCurrency[e.currency]=(refundsByCurrency[e.currency]||0)+e.amount;
          const costKnown=c=>Number.isSafeInteger(c.costMicrousd)&&['reported_usage_rated','invoice_reconciled'].includes(c.costStatus);
          const groupCalls=key=>{const grouped={};for(const c of calls){const label=c[key]||'unknown';if(!Object.hasOwn(grouped,label))Object.defineProperty(grouped,label,{value:{calls:0,knownCostMicrousd:0,unknownCostCalls:0},enumerable:true,writable:true});const g=grouped[label];g.calls++;g.knownCostMicrousd+=c.costMicrousd||0;if(!costKnown(c))g.unknownCostCalls++;}return grouped;};
          const grantedUnitsBySource={trial:0,purchase:0,review:0},consumedUnitsBySource={trial:0,purchase:0,review:0},operationCounts={};
          for(const e of entries){if(e.type==='grant')grantedUnitsBySource[e.source]=(grantedUnitsBySource[e.source]||0)+e.units;if(['consume','reverse'].includes(e.type))for(const source of ['trial','purchase','review'])consumedUnitsBySource[source]+=(e.type==='consume'?1:-1)*(e.unitsBySource?.[source]||0);}
          for(const op of Object.values(s.operations).filter(op=>inRange(op.updatedAt)))operationCounts[op.status]=(operationCounts[op.status]||0)+1;
          result={accounts:Object.keys(s.accounts).length,orders:orders.length,paidOrders:paid.length,monthlyPaidOrders:paid.filter(e=>s.orders[e.orderId]?.productKey==='reading_monthly_100').length,oneTimePaidOrders:paid.filter(e=>s.orders[e.orderId]?.productKey!=='reading_monthly_100').length,activeSubscriptions:Object.values(s.subscriptions).filter(x=>x.status==='active').length,paidUsers:new Set(paid.map(e=>e.ownerId)).size,reviewOrders:payments.filter(e=>e.source==='review').length,trialGrants:entries.filter(e=>e.type==='grant'&&e.source==='trial').length,salesByCurrency,refundsByCurrency,grantedUnits:sum(entries.filter(e=>e.type==='grant'),'units'),consumedUnits:Math.max(0,-sum(entries.filter(e=>e.type==='consume'||e.type==='reverse'),'units')),reservedUnits:Object.values(s.accounts).reduce((n,a)=>n+balance(a).reservedUnits,0),calls:calls.length,knownCostMicrousd:sum(calls,'costMicrousd'),unknownCostCalls:calls.filter(c=>!costKnown(c)).length,callsByFunding:groupCalls('funding'),callsByFeature:groupCalls('feature'),grantedUnitsBySource,consumedUnitsBySource,operationCounts,costCoverage:calls.length?calls.filter(costKnown).length/calls.length:null,paymentFeesStatus:'unknown',from:p.from,to:p.to,costBasis:'usage_estimate',complete:calls.length>0&&calls.every(costKnown)};break;
        }
        default:fail('unknown_command');
      }
      for(const key of Object.keys(state))delete state[key];Object.assign(state,s);return structuredClone(result);
    };
    if(disk)return disk.mutate('billing:'+p.mode,blank(),execute);
    const task=tail.then(()=>{const state=states.get(p.mode)||blank();const result=execute(state);states.set(p.mode,state);return result;});tail=task.catch(()=>{});return task;
  }
  return {durable:false,kind:'reference',localPersistent:Boolean(dataDir),command};
}
