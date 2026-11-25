const B='http://localhost:8787/api';let fails=0,n=0;
const call=async(m,p,body,t)=>{const r=await fetch(B+p,{method:m,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:body?JSON.stringify(body):undefined});return {s:r.status,d:await r.json()}};
const ok=(name,c,x)=>{n++;if(!c){fails++;console.log('FAIL',name,JSON.stringify(x))}};
const login=async(m,p)=>(await call('POST','/auth/login',{mobile:m,password:p})).d.token;
await call('POST','/setup',{setup_key:'k',name:'Admin',mobile:'9000000001',password:'admin123'});const A=await login('9000000001','admin123');
await call('POST','/routes',{name:'R1'},A);await call('POST','/cities',{name:'Jaipur',route_id:1},A);
for(const [x,t] of [['Dist','distributor'],['Retail','retailer'],['MRP','mrp']])await call('POST','/price-lists',{name:x,type:t,active:1},A);
await call('POST','/products',{name:'Milk',base_unit:'ltr',active:true,units:[{unit_name:'crate',factor:12}],rates:[{price_list_id:1,rate_paise:4800},{price_list_id:2,rate_paise:5200},{price_list_id:3,rate_paise:5600}]},A);
await call('POST','/products',{name:'Curd',base_unit:'kg',active:true,units:[{unit_name:'tub',factor:5}],rates:[{price_list_id:1,rate_paise:5500},{price_list_id:2,rate_paise:6000}]},A);
await call('POST','/products',{name:'Paneer',base_unit:'kg',active:true,rates:[{price_list_id:2,rate_paise:30000}]},A); // retailer rate only: no distributor rate
const dr=await call('POST','/distributors',{name:'Sharma',city_id:1,mobile:'9111111111',price_list_id:1,password:'dist123',am_cutoff:'23:59',pm_cutoff:'23:59'},A);const DID=dr.d.id;
const D=await login('9111111111','dist123');
const mk=async(name,mob)=>{const r=await call('POST','/d/retailers',{shop_name:name,mobile:mob,password:'ret123'},D);return r.d.id};
const R1=await mk('Gupta','9222222221'),R2=await mk('Verma','9222222222'),R3=await mk('Jain','9222222223');
const dem=async(rid,sess,items)=>{const r=await call('POST',`/d/retailers/${rid}/demands`,{session:sess,items},D);await call('POST',`/d/demands/${r.d.id}/approve`,{items},D);return r.d.id};
const d1=await dem(R1,'AM',[{product_id:1,unit:'crate',qty:2},{product_id:2,unit:'kg',qty:4}]); // 24 ltr + 4 kg
const d2=await dem(R2,'AM',[{product_id:1,unit:'ltr',qty:6}]);
let r=await call('GET','/d/company-orders/preview?session=AM',null,D);
ok('preview aggregates 30 ltr milk at dist rate',r.d.items.find(i=>i.product_id==1).qty_base==30&&r.d.items.find(i=>i.product_id==1).rate_paise==4800&&r.d.open&&r.d.demands.length==2,r.d);
ok('preview total',r.d.total_paise==30*4800+4*5500,r.d.total_paise);
r=await call('POST','/d/company-orders',{session:'AM'},D);ok('send order',r.s==200,r);const O1=r.d.id;
r=await call('POST','/d/company-orders',{session:'AM'},D);ok('nothing left to send',r.s==400,r);
const d3=await dem(R3,'AM',[{product_id:1,unit:'ltr',qty:5}]);
r=await call('POST','/d/company-orders',{session:'AM'},D);ok('supplementary order',r.s==200,r);const O2=r.d.id;
r=await call('GET','/d/company-orders',null,D);ok('distributor sees 2 orders, 2nd supplementary',r.d.length==2&&r.d.find(o=>o.id==O2).is_supplementary==1,r.d);
// product with no distributor rate cannot be sent
const d4=await dem(R1,'PM',[{product_id:3,unit:'kg',qty:1}]);r=await call('POST','/d/company-orders',{session:'PM'},D);ok('missing company rate blocks send',r.s==400&&/Paneer/.test(r.d.error),r);
// pull d4 stuff not in order; pull d3 out of O2 moving to PM
r=await call('POST',`/d/demands/${d4}/pull-out`,{},D);ok('pull-out of unsent demand refused',r.s==400,r);
r=await call('POST',`/d/demands/${d3}/pull-out`,{session:'PM'},D);ok('pull-out moves demand to PM, order cancelled (was only demand)',r.s==200&&r.d.order_cancelled===true,r);
r=await call('GET','/d/demands?status=approved',null,D);const x3=r.d.find(d=>d.id==d3);ok('demand now PM and unlinked',x3.session=='PM'&&x3.company_order_id==null,x3);
// company side: assistant
const as=await call('POST','/users',{name:'Doc',mobile:'9444444444',role:'assistant',password:'doc12345'},A);const S=await login('9444444444','doc12345');
r=await call('GET','/c/orders?date='+r.d?.x,null,S);r=await call('GET','/c/orders',null,S);ok('assistant lists orders',r.s==200&&r.d.length>=2,r);
r=await call('GET','/c/summary',null,S);const sm=r.d.products.find(p=>p.product_id==1);ok('summary milk = 24+6 (O2 cancelled)',sm&&sm.qty_base==30,r.d);
r=await call('GET','/c/ledgers',null,S);ok('assistant without view_ledgers blocked',r.s==403,r);
await call('PUT','/settings/assistant-perms',{approve_orders:true,dispatch:false,view_ledgers:true},A);
r=await call('GET','/c/ledgers',null,S);ok('assistant ledgers after permission',r.s==200,r);
r=await call('POST',`/c/orders/${O1}/dispatch`,{items:[{product_id:1,qty_base:1}]},S);ok('assistant without dispatch perm blocked',r.s==403,r);
r=await call('PUT',`/c/orders/${O1}`,{items:[{product_id:1,unit:'ltr',qty:28},{product_id:2,unit:'kg',qty:4}],note:'stock short'},S);ok('assistant edits order (milk 30->28)',r.s==200&&r.d.total_paise==28*4800+4*5500,r);
r=await call('GET','/notifications',null,D);ok('distributor notified of change',r.d.unread>=1&&r.d.items.some(i=>/changed/.test(i.message)),r.d);
r=await call('GET','/notifications',null,A);ok('staff notified of order',r.d.items.some(i=>/sent AM/.test(i.message)),r.d);
await call('POST','/notifications/read',null,D);r=await call('GET','/notifications',null,D);ok('mark read',r.d.unread==0,r.d);
r=await call('PATCH',`/d/demands/${d1}/session`,{session:'PM'},D);ok('distributor cannot change session of demand in sent order',r.s==400,r);
r=await call('PATCH',`/c/orders/${O1}/session`,{session:'PM',note:'wrong session'},S);ok('company moves order to PM',r.s==200,r);
r=await call('PATCH',`/c/orders/${O1}/session`,{session:'AM'},D);ok('distributor cannot move order session',r.s==403,r);
await call('PATCH',`/c/orders/${O1}/session`,{session:'AM'},A);
// dispatch
r=await call('POST',`/c/orders/${O1}/dispatch`,{items:[{product_id:1,qty_base:20}]},A);ok('partial dispatch 20 ltr',r.s==200&&r.d.status=='part_dispatched'&&r.d.total_paise==96000,r);
r=await call('POST',`/c/orders/${O1}/dispatch`,{items:[{product_id:1,qty_base:9}]},A);ok('over-dispatch blocked (only 8 left)',r.s==400,r);
r=await call('POST',`/d/demands/${d1}/pull-out`,{},D);ok('pull-out blocked once dispatch started',r.s==400,r);
r=await call('PUT',`/c/orders/${O1}`,{items:[{product_id:1,unit:'ltr',qty:1}]},A);ok('edit blocked after dispatch',r.s==400,r);
r=await call('POST',`/c/orders/${O1}/dispatch`,{items:[{product_id:1,qty_base:8},{product_id:2,qty_base:4}]},A);ok('final dispatch completes',r.s==200&&r.d.status=='dispatched',r);
r=await call('GET','/d/company-ledger',null,D);ok('distributor ledger balance = 28*4800+4*5500',r.d.balance_paise==28*4800+4*5500&&r.d.entries.length==2,r.d);
const bal=r.d.balance_paise;
r=await call('POST','/c/payments',{distributor_id:DID,amount_paise:100000,mode:'Bank',note:'NEFT'},S);ok('assistant cannot enter payment',r.s==403,r);
r=await call('POST','/c/payments',{distributor_id:DID,amount_paise:100000,mode:'Bank',note:'NEFT'},A);ok('admin enters payment',r.s==200,r);
r=await call('GET','/d/company-ledger',null,D);ok('balance reduced',r.d.balance_paise==bal-100000,r.d);const pay=r.d.entries.find(e=>e.pay_id);
r=await call('POST',`/c/payments/${pay.pay_id}/reverse`,{reason:'bounced'},A);ok('reverse',r.s==200,r);r=await call('POST',`/c/payments/${pay.pay_id}/reverse`,{},A);ok('no double reverse',r.s==400,r);
r=await call('GET',`/c/distributors/${DID}/ledger`,null,S);ok('company ledger view',r.d.entries.length==4&&r.d.entries[3].balance_paise==bal,r.d);
r=await call('GET','/c/ledgers',null,A);ok('ledger list shows balance',r.d[0].balance_paise==bal,r.d);
r=await call('POST','/admin/rebuild-balances',null,A);r=await call('GET','/c/ledgers',null,A);ok('rebuild same balance',r.d[0].balance_paise==bal,r.d);
// cutoff: block distributor, company override needs note
await call('PUT','/distributors/'+DID,{am_cutoff:'00:00',pm_cutoff:'00:00'},A);
const d5=await dem(R2,'AM',[{product_id:1,unit:'ltr',qty:3}]);
r=await call('POST','/d/company-orders',{session:'AM'},D);ok('distributor blocked after cutoff',r.s==400&&/cutoff/.test(r.d.error),r);
r=await call('POST',`/c/distributors/${DID}/orders`,{session:'AM',items:[{product_id:1,unit:'ltr',qty:3}]},A);ok('company order after cutoff needs note',r.s==400&&/note/.test(r.d.error),r);
r=await call('POST',`/c/distributors/${DID}/orders`,{session:'AM',items:[{product_id:1,unit:'ltr',qty:3}],note:'per phone call'},A);ok('company override with note',r.s==200&&r.d.override===true,r);const O3=r.d.id;
r=await call('POST',`/c/orders/${O3}/reject`,{reason:'test'},A);ok('reject order',r.s==200,r);
r=await call('POST',`/c/orders/${O3}/accept`,null,A);ok('accept after reject refused',r.s==400,r);
// reject linked order frees demands
await call('PUT','/distributors/'+DID,{am_cutoff:'23:59',pm_cutoff:'23:59'},A);
r=await call('POST','/d/company-orders',{session:'AM'},D);const O4=r.d.id;ok('resend',r.s==200,r);
r=await call('POST',`/c/orders/${O4}/reject`,{reason:'no stock'},A);r=await call('GET','/d/demands?status=approved',null,D);ok('rejected order frees demand for resend',r.d.find(d=>d.id==d5).company_order_id==null,r.d);
r=await call('GET','/c/orders',null,D);ok('distributor blocked from company API',r.s==403,r);
r=await call('GET','/c/orders?status=dispatched',null,A);ok('filter by status',r.d.length==1&&r.d[0].distributor_name=='Sharma',r.d);
console.log(fails?`${fails} FAILED of ${n}`:`ALL ${n} PASSED`);
