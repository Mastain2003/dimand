const B='http://localhost:8787/api';let fails=0;
const call=async(m,p,body,t)=>{const r=await fetch(B+p,{method:m,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:body?JSON.stringify(body):undefined});return {s:r.status,d:await r.json()}};
const ok=(n,c,x)=>{if(!c){fails++;console.log('FAIL',n,JSON.stringify(x))}else console.log('ok  ',n)};
let r=await call('POST','/setup',{setup_key:'k',name:'Admin',mobile:'9000000001',password:'admin123'});ok('setup',r.s==200,r);
r=await call('POST','/auth/login',{mobile:'9000000001',password:'admin123'});const A=r.d.token;ok('admin login',!!A,r);
await call('POST','/routes',{name:'R1'},A);await call('POST','/cities',{name:'Jaipur',route_id:1},A);
for(const [n,t] of [['Dist','distributor'],['Retail','retailer'],['MRP','mrp']])await call('POST','/price-lists',{name:n,type:t,active:1},A);
r=await call('POST','/products',{name:'Milk',base_unit:'ltr',active:true,units:[{unit_name:'crate',factor:12}],rates:[{price_list_id:1,rate_paise:4800},{price_list_id:2,rate_paise:5200},{price_list_id:3,rate_paise:5600}]},A);ok('product1',r.s==200,r);
r=await call('POST','/products',{name:'Curd',base_unit:'kg',active:true,units:[{unit_name:'tub',factor:5}],rates:[{price_list_id:2,rate_paise:6000}]},A);
await call('POST','/products',{name:'Ghee',base_unit:'kg',active:true,rates:[{price_list_id:1,rate_paise:50000}]},A); // no retailer rate: must stay hidden
r=await call('POST','/distributors',{name:'Sharma',city_id:1,mobile:'9111111111',price_list_id:1,password:'dist123'},A);ok('distributor',r.s==200,r);
r=await call('POST','/auth/login',{mobile:'9111111111',password:'dist123'});const Dt=r.d.token;ok('dist login',!!Dt,r);
r=await call('POST','/d/retailers',{shop_name:'Gupta Store',mobile:'9222222222',password:'ret123'},Dt);ok('create retailer (default list)',r.s==200,r);const RID=r.d.id;
r=await call('POST','/d/retailers',{shop_name:'Dup',mobile:'9222222222'},Dt);ok('duplicate mobile rejected + no orphan',r.s==400,r);
r=await call('GET','/d/retailers',null,Dt);ok('only 1 retailer listed',r.d.length==1&&r.d[0].price_list_name=='Retail',r.d);
r=await call('POST','/auth/login',{mobile:'9222222222',password:'ret123'});const Rt=r.d.token;ok('retailer login',!!Rt,r);
r=await call('GET','/r/products',null,Rt);ok('retailer sees 2 products w/ MRP, Ghee hidden',r.d.length==2&&r.d[0].mrp_paise!==undefined&&!r.d.find(p=>p.name=='Ghee'),r.d);
const milk=r.d.find(p=>p.name=='Milk');ok('milk rate+mrp',milk.rate_paise==5200&&milk.mrp_paise==5600,milk);
r=await call('GET','/r/info',null,Rt);ok('info',r.d.cutoffs.AM=='09:00'&&r.d.distributor_name=='Sharma',r.d);
// cutoff: set both cutoffs to 00:00 -> today closed, tomorrow ok
r=await call('PUT','/d/cutoffs',{retailer_id:null,am_cutoff:'00:00',pm_cutoff:'00:00'},Dt);ok('set cutoffs',r.s==200,r);
r=await call('POST','/r/demands',{session:'AM',items:[{product_id:milk.product_id,unit:'crate',qty:2}]},Rt);ok('cutoff blocks today',r.s==400&&/cutoff/.test(r.d.error),r);
const tm=new Date(Date.now()+5.5*3600e3+864e5).toISOString().slice(0,10);
r=await call('POST','/r/demands',{session:'AM',demand_date:tm,items:[{product_id:milk.product_id,unit:'crate',qty:2}]},Rt);ok('tomorrow allowed',r.s==200&&r.d.total_paise==2*12*5200,r);const D1=r.d.id;
await call('PUT','/d/cutoffs',{retailer_id:null,am_cutoff:'23:59',pm_cutoff:'23:59'},Dt);
r=await call('POST','/r/demands',{session:'PM',items:[{product_id:milk.product_id,unit:'ltr',qty:10},{product_id:milk.product_id+1,unit:'tub',qty:1}]},Rt);ok('today PM allowed, 2 items',r.s==200&&r.d.total_paise==10*5200+5*6000,r);const D2=r.d.id;
r=await call('POST','/r/demands',{session:'PM',items:[{product_id:3,unit:'kg',qty:1}]},Rt);ok('product without rate refused',r.s==400,r);
r=await call('POST','/r/demands',{session:'PM',items:[{product_id:milk.product_id,unit:'bag',qty:1}]},Rt);ok('bad unit refused',r.s==400,r);
r=await call('PUT','/r/demands/'+D2,{items:[{product_id:milk.product_id,unit:'ltr',qty:20}]},Rt);ok('retailer edits own demand',r.s==200&&r.d.total_paise==20*5200,r);
r=await call('POST','/r/demands/'+D1+'/cancel',null,Rt);ok('retailer cancels',r.s==200,r);
r=await call('POST','/r/demands/'+D1+'/cancel',null,Rt);ok('cancel twice refused',r.s==400,r);
r=await call('GET','/d/demands?status=submitted',null,Dt);ok('inbox shows 1 pending',r.d.length==1&&r.d[0].shop_name=='Gupta Store',r.d);
// other distributor cannot touch it
r=await call('POST','/distributors',{name:'Other',city_id:1,mobile:'9333333333',password:'other123'},A);const O=(await call('POST','/auth/login',{mobile:'9333333333',password:'other123'})).d.token;
r=await call('POST','/d/demands/'+D2+'/approve',{items:[{product_id:milk.product_id,unit:'ltr',qty:5}]},O);ok('other distributor blocked',r.s==400,r);
// approve with edited quantity and rate (5000 per ltr)
r=await call('POST','/d/demands/'+D2+'/approve',{items:[{product_id:milk.product_id,unit:'ltr',qty:15,rate_paise:5000}]},Dt);ok('approve edited',r.s==200&&r.d.total_paise==75000,r);
r=await call('PATCH','/d/demands/'+D2+'/session',{session:'AM'},Dt);ok('distributor changes session',r.s==200,r);
r=await call('PATCH','/r/demands/'+D2+'/session',{session:'PM'},Rt);ok('retailer cannot change session',r.s==404||r.s==400,r);
// partial dispatch 10 ltr
r=await call('POST','/d/demands/'+D2+'/dispatch',{items:[{product_id:milk.product_id,qty_base:10}]},Dt);ok('partial dispatch',r.s==200&&r.d.status=='part_dispatched'&&r.d.total_paise==50000,r);
r=await call('POST','/d/demands/'+D2+'/dispatch',{items:[{product_id:milk.product_id,qty_base:6}]},Dt);ok('over-dispatch refused',r.s==400,r);
r=await call('PATCH','/d/demands/'+D2+'/session',{session:'PM'},Dt);ok('session locked after dispatch',r.s==400,r);
r=await call('POST','/d/demands/'+D2+'/approve',{items:[{product_id:milk.product_id,qty:1}]},Dt);ok('approval locked after dispatch',r.s==400,r);
r=await call('POST','/d/demands/'+D2+'/dispatch',{items:[{product_id:milk.product_id,qty_base:5}]},Dt);ok('final dispatch completes',r.s==200&&r.d.status=='dispatched',r);
r=await call('POST','/d/payments',{retailer_id:RID,amount_paise:30000,mode:'UPI',note:'part'},Dt);ok('payment',r.s==200,r);
r=await call('GET','/r/ledger',null,Rt);ok('ledger: 2 dispatch + 1 payment, balance 45000',r.d.entries.length==3&&r.d.balance_paise==45000,r.d);
r=await call('GET','/d/retailers',null,Dt);ok('cached balance = 45000',r.d[0].balance_paise==45000,r.d);
r=await call('GET','/d/retailers/'+RID+'/ledger',null,Dt);const pay=r.d.entries.find(e=>e.pay_id);
r=await call('POST','/d/payments/'+pay.pay_id+'/reverse',{reason:'bounced'},Dt);ok('reverse payment',r.s==200,r);
r=await call('POST','/d/payments/'+pay.pay_id+'/reverse',{},Dt);ok('double reverse refused',r.s==400,r);
r=await call('GET','/r/ledger',null,Rt);ok('balance back to 75000, 4 entries',r.d.balance_paise==75000&&r.d.entries.length==4,r.d);
r=await call('POST','/admin/rebuild-balances',null,A);r=await call('GET','/d/retailers',null,Dt);ok('rebuild matches cache',r.d[0].balance_paise==75000,r.d);
r=await call('GET','/r/demands',null,Rt);const d2=r.d.find(x=>x.id==D2);ok('retailer sees dispatched items+approved rate',d2.status=='dispatched'&&d2.dispatched_base[milk.product_id]==15&&d2.approved[0].rate_paise==5000,d2);
// phone order by distributor ignores cutoff, close short
await call('PUT','/d/cutoffs',{retailer_id:null,am_cutoff:'00:00',pm_cutoff:'00:00'},Dt);
r=await call('POST','/d/retailers/'+RID+'/demands',{session:'AM',items:[{product_id:milk.product_id,unit:'ltr',qty:4}]},Dt);ok('phone order after cutoff',r.s==200,r);const D3=r.d.id;
await call('POST','/d/demands/'+D3+'/approve',{items:[{product_id:milk.product_id,unit:'ltr',qty:4}]},Dt);
r=await call('POST','/d/demands/'+D3+'/dispatch',{items:[{product_id:milk.product_id,qty_base:3}],close_short:true},Dt);ok('close short',r.d.status=='dispatched',r);
r=await call('POST','/d/demands/'+D3+'/reject',{},Dt);ok('reject after dispatch refused',r.s==400,r);
r=await call('PUT','/d/cutoffs',{retailer_id:RID,am_cutoff:'10:00',pm_cutoff:'17:30'},Dt);r=await call('GET','/d/cutoffs',null,Dt);ok('override saved',r.d.overrides.length==1&&r.d.default.am_cutoff=='00:00',r.d);
r=await call('POST','/users/'+(await call('GET','/users',null,A)).d.find(u=>u.mobile=='9222222222').id+'/reset-password',null,Dt);ok('distributor resets retailer pw',!!r.d.temp_password,r);
r=await call('POST','/users/1/reset-password',null,Dt);ok('distributor cannot reset admin',r.s==403,r);
r=await call('GET','/d/demands',null,Rt);ok('retailer blocked from distributor API',r.s==403,r);
console.log(fails?`${fails} FAILED`:'ALL PASSED');
