import json,urllib.request,http.server,threading,functools,datetime
from playwright.sync_api import sync_playwright
def call(m,p,b=None,t=None):
    r=urllib.request.Request('http://localhost:8787/api'+p,method=m,data=json.dumps(b).encode() if b is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+t} if t else {})})
    return json.loads(urllib.request.urlopen(r).read())
call('POST','/setup',{'setup_key':'k','name':'Admin','mobile':'9000000001','password':'admin123'})
A=call('POST','/auth/login',{'mobile':'9000000001','password':'admin123'})['token']
call('POST','/routes',{'name':'Route 1'},A);call('POST','/routes',{'name':'Route 2'},A);call('POST','/cities',{'name':'Jaipur','route_id':1},A);call('POST','/cities',{'name':'Kota','route_id':2},A)
for n,t in [('Dist','distributor'),('Retail','retailer'),('MRP','mrp')]:call('POST','/price-lists',{'name':n,'type':t,'active':1},A)
call('POST','/products',{'name':'Fresh Milk','base_unit':'ltr','active':True,'units':[{'unit_name':'crate','factor':12}],'rates':[{'price_list_id':1,'rate_paise':4800},{'price_list_id':2,'rate_paise':5200}]},A)
call('POST','/products',{'name':'Curd','base_unit':'kg','active':True,'rates':[{'price_list_id':1,'rate_paise':5500},{'price_list_id':2,'rate_paise':6000}]},A)
dA=call('POST','/distributors',{'name':'Sharma Traders','city_id':1,'mobile':'9111111111','price_list_id':1,'password':'x12345'},A)['id']
dB=call('POST','/distributors',{'name':'Rathore Sons','city_id':2,'mobile':'9111111112','price_list_id':1,'password':'x12345'},A)['id']
ist=datetime.datetime.utcnow()+datetime.timedelta(hours=5.5);D0=(ist-datetime.timedelta(days=1)).date()
def hist(did,date,pid,qty,sess='AM'):
    o=call('POST',f'/c/distributors/{did}/orders',{'session':sess,'date':str(date),'items':[{'product_id':pid,'unit':'ltr' if pid==1 else 'kg','qty':qty}],'note':'hist'},A);call('POST',f'/c/orders/{o["id"]}/dispatch',{'items':[{'product_id':pid,'qty_base':qty}],'dispatch_date':str(date)},A)
for k in range(0,12):
    d=D0-datetime.timedelta(days=k)
    hist(dA,d,1,20+k);hist(dB,d,1,10+k,'PM');hist(dA,d,2,5)
    try:ly=d.replace(year=d.year-1);hist(dA,ly,1,18+k)
    except ValueError:pass
H=functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/distro/app');H.log_message=lambda *a:None
threading.Thread(target=http.server.ThreadingHTTPServer(('127.0.0.1',8123),H).serve_forever,daemon=True).start()
STUB="window.XLSX={read:(b)=>{const j=JSON.parse(new TextDecoder().decode(b));return {SheetNames:Object.keys(j),Sheets:j}},utils:{sheet_to_json:(ws)=>ws}};"
errs=[]
with sync_playwright() as p:
    br=p.chromium.launch();pg=br.new_context(viewport={'width':390,'height':780}).new_page()
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None);pg.on('pageerror',lambda e:errs.append('PAGEERR '+str(e)))
    pg.route('**/xlsx.full.min.js',lambda r:r.fulfill(status=200,content_type='application/javascript',body=STUB))
    pg.goto('http://127.0.0.1:8123/index.html');pg.wait_for_selector('.login');pg.fill('input[type=tel]','9000000001');pg.fill('input[type=password]','admin123');pg.click('button:has-text("Log in")')
    pg.wait_for_selector('svg.chart');print('dashboard loaded; compare card:',pg.inner_text('.card:has-text("Compare a day")').replace('\n',' | ')[:230]);pg.screenshot(path='/tmp/w1.png',full_page=True)
    pg.select_option('label:has(span:text-is("Product")) select','1');pg.click('.seg >> text=Quantity');pg.wait_for_timeout(600);print('qty view:',pg.inner_text('.card >> nth=1').replace('\n',' | ')[:120])
    pg.click('.seg >> text=City');pg.wait_for_selector('.hb');print('by city rows:',pg.locator('.hb').count());pg.screenshot(path='/tmp/w2.png',full_page=True)
    pg.click('.seg >> text=To retailers');pg.wait_for_timeout(600);print('retailer level (no sales):',pg.inner_text('.card:has-text("Compare")').replace('\n',' | ')[:150])
    pg.click('nav >> text=Settings');pg.wait_for_selector('text=Staff logins');pg.click('button:has-text("Import")');pg.wait_for_selector('text=Import from Excel')
    data={'Read me':[{'a':'x'}],'Cities':[{'City':'Ajmer','Route':'Route 1'},{'City':'Bad','Route':'Nope'}],'Distributors':[{'Name':'Meena Dairy','City':'Ajmer','Mobile':'9333000001','PriceList':'Dist','AMCutoff':'09:30','PMCutoff':'16:00'}],'Retailers':[{'ShopName':'Test Shop','Distributor':'Meena Dairy','Mobile':'9333100001'}]}
    pg.set_input_files('input[type=file]',{'name':'t.xlsx','mimeType':'application/octet-stream','buffer':json.dumps(data).encode()});pg.wait_for_selector('text=Distributors (sheet');print('detected:',pg.inner_text('.card:has-text("2. Choose")').replace('\n',' | ')[:200])
    pg.click('button:has-text("Import now")');pg.wait_for_selector('text=Result');pg.wait_for_timeout(500);print('result:',pg.inner_text('.card:has-text("Result")').replace('\n',' | '));print('problems:',pg.inner_text('.card:has-text("not imported")').replace('\n',' | ')[:160]);print('logins card:',pg.locator('text=new logins created').inner_text());pg.screenshot(path='/tmp/w3.png',full_page=True)
    print([d['name'] for d in call('GET','/distributors',None,A)])
    print('errors:',errs);br.close()
