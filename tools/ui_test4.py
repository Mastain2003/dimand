import json,urllib.request,http.server,threading,functools
from playwright.sync_api import sync_playwright
def call(m,p,b=None,t=None):
    r=urllib.request.Request('http://localhost:8787/api'+p,method=m,data=json.dumps(b).encode() if b is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+t} if t else {})})
    return json.loads(urllib.request.urlopen(r).read())
call('POST','/setup',{'setup_key':'k','name':'Admin','mobile':'9000000001','password':'admin123'})
A=call('POST','/auth/login',{'mobile':'9000000001','password':'admin123'})['token']
call('POST','/routes',{'name':'R1'},A);call('POST','/cities',{'name':'Jaipur','route_id':1},A)
for n,t in [('Dist','distributor'),('Retail','retailer'),('MRP','mrp')]:call('POST','/price-lists',{'name':n,'type':t,'active':1},A)
call('POST','/products',{'name':'Fresh Milk','base_unit':'ltr','active':True,'units':[{'unit_name':'crate','factor':12}],'rates':[{'price_list_id':1,'rate_paise':4800},{'price_list_id':2,'rate_paise':5200},{'price_list_id':3,'rate_paise':5600}]},A)
call('POST','/distributors',{'name':'Sharma Traders','city_id':1,'mobile':'9111111111','price_list_id':1,'password':'dist123','am_cutoff':'23:59','pm_cutoff':'23:59'},A)
D=call('POST','/auth/login',{'mobile':'9111111111','password':'dist123'})['token']
def mk(n,m):return call('POST','/d/retailers',{'shop_name':n,'mobile':m,'password':'ret123'},D)['id']
def dem(rid,s,q):
    items=[{'product_id':1,'unit':'crate','qty':q}];i=call('POST',f'/d/retailers/{rid}/demands',{'session':s,'items':items},D)['id'];call('POST',f'/d/demands/{i}/approve',{'items':items},D);return i
R1,R2=mk('Gupta','9222222221'),mk('Verma','9222222222');dem(R1,'AM',2);d2=dem(R2,'AM',1)
H=functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/distro/app');H.log_message=lambda *a:None
threading.Thread(target=http.server.ThreadingHTTPServer(('127.0.0.1',8123),H).serve_forever,daemon=True).start()
errs=[]
def login(pg,m,pw):
    pg.goto('http://127.0.0.1:8123/index.html');pg.wait_for_selector('.login');pg.fill('input[type=tel]',m);pg.fill('input[type=password]',pw);pg.click('button:has-text("Log in")')
def btn(pg,t):pg.click(f'.sheet .btns button:has-text("{t}")')
with sync_playwright() as p:
    br=p.chromium.launch()
    def newpage():
        pg=br.new_context(viewport={'width':390,'height':780}).new_page()
        pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None);pg.on('pageerror',lambda e:errs.append('PAGEERR '+str(e)));return pg
    d=newpage();login(d,'9111111111','dist123');d.wait_for_selector('text=Set a new password');d.click('button:has-text("Change password")');d.wait_for_selector('.sheet');i=d.locator('.sheet input[type=password]');i.nth(0).fill('dist123');i.nth(1).fill('dist1234');i.nth(2).fill('dist1234');btn(d,'Save')
    d.wait_for_selector('nav.tabs');d.click('nav >> text=Company');d.wait_for_selector('text=Payable to company');print('preview:',d.inner_text('.card:has-text("Payable")').replace('\n',' | ')[:160]);d.screenshot(path='/tmp/v1.png')
    d.click('button:has-text("Send to company")');d.wait_for_selector('.card:has-text("#1")');print('order sent, orders tab visible')
    a=newpage();login(a,'9000000001','admin123');a.wait_for_selector('nav.tabs');a.click('nav >> text=Orders');a.wait_for_selector('.card:has-text("Sharma Traders")');a.screenshot(path='/tmp/v2.png');print('admin sees order:',a.inner_text('.card:has-text("Sharma")').replace('\n',' | ')[:200])
    print('summary:',a.inner_text('.card:has-text("Total demand")').replace('\n',' | ')[:160])
    a.click('button:has-text("Accept")');a.wait_for_selector('.seg >> text=To dispatch');a.click('.seg >> text=To dispatch');a.wait_for_selector('.card button:has-text("Edit")')
    a.click('.card button:has-text("Edit")');a.wait_for_selector('.arow');a.locator('.arow input').first.fill('3');a.fill('.sheet label:has-text("Reason") input','stock short');btn(a,'Save');a.wait_for_timeout(500)
    a.click('.card button:has-text("Dispatch")');a.wait_for_selector('.sheet .arow');a.screenshot(path='/tmp/v3.png');btn(a,'Dispatch');a.wait_for_timeout(500)
    a.click('.seg >> text=Done');a.wait_for_selector('.card:has-text("Dispatched")');print('order done')
    d.click('nav >> text=Account') if False else None
    d.click('.seg >> text=Account');d.wait_for_selector('table.led');print('dist ledger:',d.inner_text('.card.row').replace('\n',' '));d.screenshot(path='/tmp/v4.png')
    d.reload();d.wait_for_selector('nav.tabs');print('bell count:',d.inner_text('.bell').strip())
    a.click('nav >> text=Ledger');a.wait_for_selector('.card:has-text("Sharma")');a.click('.card:has-text("Sharma")');a.wait_for_selector('button:has-text("+ Payment received")');a.click('button:has-text("+ Payment received")');a.fill('.sheet input[type=number]','1000');btn(a,'Save');a.wait_for_timeout(600);print('admin ledger balance:',a.inner_text('.card.row').replace('\n',' '));a.screenshot(path='/tmp/v5.png')
    # pull-out flow: new AM demand sent, then pulled out and moved to PM
    d3=dem(R1,'AM',1)
    d.click('nav >> text=Company');d.click('.seg >> text=Send order');d.wait_for_selector('text=Payable to company');d.click('button:has-text("Send to company")');d.wait_for_selector('.card:has-text("#2")')
    d.click('nav >> text=Demands');d.click('.seg >> text=To dispatch');d.wait_for_selector('button:has-text("Pull out of company order")');d.click('button:has-text("Pull out of company order")');d.wait_for_selector('.sheet')
    d.select_option('.sheet select','PM');btn(d,'Pull out');d.wait_for_timeout(700);d.screenshot(path='/tmp/v6.png')
    st=call('GET','/d/demands?status=approved',None,D);x=[z for z in st if z['id']==d3][0];print('after pull-out: session',x['session'],'order',x['company_order_id'])
    print('errors:',errs);br.close()
