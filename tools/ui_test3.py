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
call('POST','/products',{'name':'Curd','base_unit':'kg','active':True,'units':[{'unit_name':'tub','factor':5}],'rates':[{'price_list_id':1,'rate_paise':5500},{'price_list_id':2,'rate_paise':6000},{'price_list_id':3,'rate_paise':6500}]},A)
call('POST','/distributors',{'name':'Sharma Traders','city_id':1,'mobile':'9111111111','price_list_id':1,'password':'dist123'},A)
H=functools.partial(http.server.SimpleHTTPRequestHandler,directory='/home/claude/distro/app');H.log_message=lambda *a:None
threading.Thread(target=http.server.ThreadingHTTPServer(('127.0.0.1',8123),H).serve_forever,daemon=True).start()
errs=[]
def login(pg,m,pw):
    pg.goto('http://127.0.0.1:8123/index.html');pg.wait_for_selector('.login');pg.fill('input[type=tel]',m);pg.fill('input[type=password]',pw);pg.click('button:has-text("Log in")')
with sync_playwright() as p:
    br=p.chromium.launch()
    def newpage():
        pg=br.new_context(viewport={'width':390,'height':780}).new_page()
        pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None);pg.on('pageerror',lambda e:errs.append('PAGEERR '+str(e)));return pg
    def forced(pg,old,new):
        pg.wait_for_selector('text=Set a new password');pg.click('button:has-text("Change password")');pg.wait_for_selector('.sheet');i=pg.locator('.sheet input[type=password]');i.nth(0).fill(old);i.nth(1).fill(new);i.nth(2).fill(new);pg.click('.sheet >> text=Save')
    d=newpage();login(d,'9111111111','dist123');forced(d,'dist123','dist1234');d.wait_for_selector('nav.tabs')
    d.click('nav >> text=Retailers');d.click('button:has-text("+ Add")');d.wait_for_selector('.sheet')
    d.fill('.sheet label:nth-of-type(1) input','Gupta Store');d.fill('.sheet input[type=tel]','9222222222');d.click('.sheet >> text=Create')
    d.wait_for_selector('.secret');tmp=d.inner_text('.secret');print('retailer temp pw:',tmp);d.click('text=Done');d.wait_for_selector('text=Gupta Store')
    r=newpage();login(r,'9222222222',tmp);forced(r,tmp,'newpass1')
    r.wait_for_selector('.prow');r.screenshot(path='/tmp/u1.png')
    milk=r.locator('.prow',has_text='Fresh Milk');milk.locator('select').select_option('crate');milk.locator('input').fill('2')
    print('total shown:',r.inner_text('.bar b'));r.click('button:has-text("Send demand")');r.wait_for_selector('.card:has-text("Waiting")');r.screenshot(path='/tmp/u2.png')
    d.click('nav >> text=Demands');d.wait_for_selector('.card:has-text("Gupta Store")');d.screenshot(path='/tmp/u3.png');d.click('button:has-text("Approve / edit")');d.wait_for_selector('.arow')
    rate=d.locator('.arow input').nth(1);print('default rate/ltr:',rate.input_value());rate.fill('50');d.screenshot(path='/tmp/u4.png');d.click('.sheet .btns button:has-text("Approve")');d.wait_for_timeout(500)
    d.click('.seg >> text=To dispatch');d.wait_for_selector('.card button:has-text("Dispatch")');d.click('.card button:has-text("Dispatch")');d.wait_for_selector('.sheet');d.locator('.sheet .arow input').first.fill('10');d.click('.sheet .btns button:has-text("Dispatch")');d.wait_for_timeout(500)
    d.click('nav >> text=Retailers');d.click('.card:has-text("Gupta Store")');d.wait_for_selector('h3:has-text("Ledger")');d.click('button:has-text("+ Payment")');d.wait_for_selector('.sheet');d.fill('.sheet input[type=number]','200');d.click('.sheet .btns button:has-text("Save")');d.wait_for_timeout(600);d.screenshot(path='/tmp/u5.png')
    r.click('nav >> text=Ledger');r.wait_for_selector('table.led');r.screenshot(path='/tmp/u6.png');print('retailer balance card:',r.inner_text('.card.row').replace('\n',' '))
    r.click('nav >> text=Prices');r.wait_for_selector('text=MRP');r.click('nav >> text=My demands');r.wait_for_selector('text=Part dispatched');print('demand status shows Part dispatched')
    d.click('nav >> text=Account');d.wait_for_selector('text=Retailer order cutoff times');d.screenshot(path='/tmp/u7.png')
    print('errors:',errs);br.close()
