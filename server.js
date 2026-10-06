// Multi-photographer proofing platform with Stripe monthly subscriptions. No dependencies except optional sharp.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
let sharp=null;try{sharp=require('sharp')}catch(e){console.warn('! sharp not installed: previews are NOT resized/watermarked. Run: npm install')}
const E=process.env,PORT=E.PORT||3000,PLATFORM=E.PLATFORM_NAME||'Printpick',BASE=(E.BASE_URL||'').replace(/\/$/,'');
const OWNER_EMAIL=(E.OWNER_EMAIL||'').toLowerCase(),TRIAL_DAYS=+(E.TRIAL_DAYS||14),LIMIT=(+(E.STORAGE_LIMIT_GB||20))*1e9;
const SK=E.STRIPE_SECRET_KEY,PRICE=E.STRIPE_PRICE_ID,WH=E.STRIPE_WEBHOOK_SECRET,PRICE_LABEL=E.PRICE_LABEL||'$19 / month';
const D=E.DATA_DIR||path.join(__dirname,'data');
['originals','previews'].forEach(d=>fs.mkdirSync(path.join(D,d),{recursive:true}));
const DBF=path.join(D,'db.json'),SF=path.join(D,'secret.txt');
let db=fs.existsSync(DBF)?JSON.parse(fs.readFileSync(DBF)):{};db.users=db.users||{};db.galleries=db.galleries||{};
const save=()=>fs.writeFileSync(DBF,JSON.stringify(db));
const SECRET=E.SECRET||(fs.existsSync(SF)?fs.readFileSync(SF,'utf8'):(()=>{const s=crypto.randomBytes(32).toString('hex');fs.writeFileSync(SF,s);return s})());
const rid=n=>crypto.randomBytes(n).toString('hex');
const sign=v=>crypto.createHmac('sha256',SECRET).update(v).digest('hex');
const eq=(a,b)=>a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const me=r=>{const m=/(?:^|;\s*)s=([a-f0-9]+)\.([a-f0-9]+)/.exec(r.headers.cookie||'');return m&&eq(sign(m[1]),m[2])?db.users[m[1]]||null:null};
const active=u=>!!u&&!!(u.owner||u.status==='active'||(u.status==='trial'&&u.trialEnds>Date.now()));
const hash=(pw,salt=rid(8))=>salt+':'+crypto.scryptSync(pw,salt,32).toString('hex');
const check=(pw,h)=>eq(hash(pw,h.split(':')[0]),h);
const json=(res,code,o)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
const body=(req,max=80e6)=>new Promise((ok,no)=>{let c=[],n=0;req.on('data',d=>{n+=d.length;if(n>max){no(new Error('too big'));req.destroy()}else c.push(d)});req.on('end',()=>ok(Buffer.concat(c)));req.on('error',no)});
const jbody=async r=>{try{return JSON.parse((await body(r,1e6)).toString()||'{}')}catch(e){return{}}};
const page=(res,f)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'public',f)).toString().replace(/__PLATFORM__/g,PLATFORM).replace(/__PRICE__/g,PRICE_LABEL).replace(/__TRIAL__/g,TRIAL_DAYS))};
const tries={},limited=ip=>(tries[ip]=(tries[ip]||[]).filter(t=>t>Date.now()-6e5)).length>=10;
const origin=r=>BASE||('http://'+r.headers.host);
const flat=(o,p,out=[])=>{for(const k in o){const key=p?p+'['+k+']':k;typeof o[k]==='object'?flat(o[k],key,out):out.push(encodeURIComponent(key)+'='+encodeURIComponent(o[k]))}return out};
const stripe=(p,params)=>fetch('https://api.stripe.com/v1'+p,{method:'POST',headers:{Authorization:'Bearer '+SK,'Content-Type':'application/x-www-form-urlencoded'},body:flat(params).join('&')}).then(r=>r.json());
const userOf=g=>db.users[g.owner];
async function makePreview(buf,out,studio){
  if(!sharp){fs.writeFileSync(out,buf);return}
  const s=String(studio||'').replace(/[<&>]/g,'');
  const {data,info}=await sharp(buf).rotate().resize(1400,1400,{fit:'inside',withoutEnlargement:true}).toBuffer({resolveWithObject:true});
  const f=Math.max(18,Math.round(info.width/38)),pw=Math.round((s.length+8)*f*0.66+f*3),ph=f*6;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}"><defs><pattern id="p" width="${pw}" height="${ph}" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)"><text x="0" y="${f*3}" font-size="${f}" font-family="sans-serif" font-weight="700" fill="#fff" fill-opacity=".55" stroke="#000" stroke-opacity=".3">${s} · PROOF</text></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`;
  const wm=await sharp(Buffer.from(svg)).png().toBuffer();
  await sharp(data).composite([{input:wm}]).jpeg({quality:72}).toFile(out);
}
const rmPhoto=id=>['originals/'+id+'.bin','previews/'+id+'.jpg'].forEach(n=>fs.rmSync(path.join(D,n),{force:true}));
const meInfo=u=>({email:u.email,studio:u.studio,owner:!!u.owner,active:active(u),status:u.status,daysLeft:u.status==='trial'?Math.max(0,Math.ceil((u.trialEnds-Date.now())/864e5)):null,usedGB:+((u.bytes||0)/1e9).toFixed(2),limitGB:LIMIT/1e9,billing:!!(SK&&PRICE),hasCustomer:!!u.customer});
function startSession(res,u){res.setHeader('Set-Cookie','s='+u.id+'.'+sign(u.id)+'; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000'+(BASE.startsWith('https')?'; Secure':''))}

http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://x'),p=u.pathname,m=req.method,user=me(req),ip=req.headers['x-forwarded-for']||req.socket.remoteAddress;let x;
    if(p==='/app.css'){res.writeHead(200,{'Content-Type':'text/css','Cache-Control':'public, max-age=300'});return res.end(fs.readFileSync(path.join(__dirname,'public','app.css')))}
    if(p==='/')return page(res,'index.html');
    if(p==='/admin')return page(res,'admin.html');
    if(x=p.match(/^\/g\/([a-f0-9]+)$/))return db.galleries[x[1]]?page(res,'gallery.html'):(res.writeHead(404),res.end('Gallery not found'));
    if(p==='/api/signup'&&m==='POST'){const b=await jbody(req),email=String(b.email||'').trim().toLowerCase();
      if(limited(ip))return json(res,429,{error:'Too many attempts. Try again later.'});tries[ip].push(Date.now());
      if(!/^\S+@\S+\.\S+$/.test(email)||String(b.password||'').length<8||!String(b.studio||'').trim())return json(res,400,{error:'Enter your studio name, a valid email and a password of 8+ characters.'});
      if(Object.values(db.users).some(v=>v.email===email))return json(res,409,{error:'That email already has an account. Log in instead.'});
      const id=rid(8);db.users[id]={id,email,studio:String(b.studio).trim().slice(0,60),pw:hash(b.password),status:'trial',trialEnds:Date.now()+TRIAL_DAYS*864e5,bytes:0,owner:email===OWNER_EMAIL,created:Date.now()};save();startSession(res,db.users[id]);return json(res,200,{ok:1})}
    if(p==='/api/login'&&m==='POST'){const b=await jbody(req),email=String(b.email||'').trim().toLowerCase();
      if(limited(ip))return json(res,429,{error:'Too many attempts. Try again later.'});
      const v=Object.values(db.users).find(v=>v.email===email);
      if(!v||!check(String(b.password||''),v.pw)){tries[ip].push(Date.now());return json(res,401,{error:'Wrong email or password'})}
      startSession(res,v);return json(res,200,{ok:1})}
    if(p==='/api/logout'){res.setHeader('Set-Cookie','s=; Path=/; Max-Age=0');return json(res,200,{ok:1})}
    if(p==='/api/me')return user?json(res,200,meInfo(user)):json(res,401,{});
    if(p==='/api/billing/checkout'&&m==='POST'){if(!user)return json(res,401,{});if(!SK||!PRICE)return json(res,501,{error:'Billing is not set up yet.'});
      const s=await stripe('/checkout/sessions',{mode:'subscription',client_reference_id:user.id,customer_email:user.email,'line_items':{0:{price:PRICE,quantity:1}},success_url:origin(req)+'/admin?paid=1',cancel_url:origin(req)+'/admin'});
      return s.url?json(res,200,{url:s.url}):json(res,502,{error:'Could not start checkout'})}
    if(p==='/api/billing/portal'&&m==='POST'){if(!user)return json(res,401,{});if(!SK||!user.customer)return json(res,400,{error:'No subscription yet.'});
      const s=await stripe('/billing_portal/sessions',{customer:user.customer,return_url:origin(req)+'/admin'});return s.url?json(res,200,{url:s.url}):json(res,502,{error:'Could not open billing'})}
    if(p==='/stripe/webhook'&&m==='POST'){const raw=(await body(req,1e6)).toString(),h=String(req.headers['stripe-signature']||'');
      const t=(/t=(\d+)/.exec(h)||[])[1],sigs=[...h.matchAll(/v1=([a-f0-9]+)/g)].map(a=>a[1]);
      const good=WH&&t&&Math.abs(Date.now()/1e3-t)<300&&sigs.some(s=>eq(crypto.createHmac('sha256',WH).update(t+'.'+raw).digest('hex'),s));
      if(!good)return json(res,400,{error:'bad signature'});
      const ev=JSON.parse(raw),o=ev.data.object;
      if(ev.type==='checkout.session.completed'&&db.users[o.client_reference_id]){const v=db.users[o.client_reference_id];v.customer=o.customer;v.status='active'}
      if(/^customer\.subscription\.(updated|deleted)$/.test(ev.type)){const v=Object.values(db.users).find(v=>v.customer===o.customer);if(v)v.status=['active','trialing'].includes(o.status)?'active':'inactive'}
      save();return json(res,200,{received:1})}
    if(p==='/api/galleries'&&m==='GET'){if(!user)return json(res,401,{});
      return json(res,200,Object.entries(db.galleries).filter(([t,g])=>g.owner===user.id).map(([t,g])=>({token:t,client:g.client,status:g.status,count:g.photos.length,picks:g.picks.length,created:g.created})).sort((a,b)=>b.created-a.created))}
    if(p==='/api/galleries'&&m==='POST'){if(!user)return json(res,401,{});if(!active(user))return json(res,402,{error:'Subscribe to create galleries.'});
      const b=await jbody(req),t=rid(12);db.galleries[t]={owner:user.id,client:String(b.client||'Client').slice(0,80),photos:[],picks:[],status:'open',created:Date.now()};save();return json(res,200,{token:t})}
    if(x=p.match(/^\/api\/galleries\/([a-f0-9]+)(?:\/(photos|picks|reopen))?(?:\/([a-f0-9]+))?$/)){
      const g=db.galleries[x[1]];if(!g)return json(res,404,{error:'Not found'});
      const own=!!user&&g.owner===user.id,ow=userOf(g);
      if(!x[2]&&m==='GET'){if(!own&&!active(ow))return json(res,403,{error:'unavailable'});
        return json(res,200,{client:g.client,studio:ow&&ow.studio,status:g.status,picks:g.picks,note:g.note||'',name:g.name||'',photos:g.photos.map(f=>({id:f.id,name:f.name}))})}
      if(!x[2]&&m==='DELETE'){if(!own)return json(res,401,{});g.photos.forEach(f=>{rmPhoto(f.id);ow.bytes=Math.max(0,(ow.bytes||0)-(f.size||0))});delete db.galleries[x[1]];save();return json(res,200,{ok:1})}
      if(x[2]==='photos'&&m==='POST'){if(!own)return json(res,401,{});if(!active(ow))return json(res,402,{error:'Subscription needed to upload.'});
        const buf=await body(req),pid=rid(5),name=(u.searchParams.get('name')||'photo.jpg').replace(/[^\w.\- ]/g,'_').slice(0,120);
        if((ow.bytes||0)+buf.length>LIMIT)return json(res,413,{error:'Storage full ('+LIMIT/1e9+' GB). Delete old galleries.'});
        fs.writeFileSync(path.join(D,'originals',pid+'.bin'),buf);
        try{await makePreview(buf,path.join(D,'previews',pid+'.jpg'),ow.studio)}catch(e){fs.rmSync(path.join(D,'originals',pid+'.bin'),{force:true});return json(res,400,{error:'Not a supported image'})}
        g.photos.push({id:pid,name,size:buf.length});ow.bytes=(ow.bytes||0)+buf.length;save();return json(res,200,{id:pid})}
      if(x[2]==='photos'&&m==='DELETE'){if(!own)return json(res,401,{});const f=g.photos.find(f=>f.id===x[3]);if(!f)return json(res,404,{});
        g.photos=g.photos.filter(f=>f.id!==x[3]);g.picks=g.picks.filter(i=>i!==x[3]);rmPhoto(x[3]);ow.bytes=Math.max(0,(ow.bytes||0)-(f.size||0));save();return json(res,200,{ok:1})}
      if(x[2]==='picks'&&m==='POST'){const b=await jbody(req);if(!own&&!active(ow))return json(res,403,{error:'unavailable'});
        if(g.status==='submitted'&&!own)return json(res,403,{error:'Already sent'});
        const ids=new Set(g.photos.map(f=>f.id));g.picks=[...new Set((b.picks||[]).filter(i=>ids.has(i)))];
        if(b.submit){g.status='submitted';g.name=String(b.name||'').slice(0,80);g.note=String(b.note||'').slice(0,1000);g.submitted=Date.now()}
        save();return json(res,200,{ok:1,status:g.status})}
      if(x[2]==='reopen'&&m==='POST'){if(!own)return json(res,401,{});g.status='open';save();return json(res,200,{ok:1})}
    }
    if(x=p.match(/^\/(p|o)\/([a-f0-9]+)\/([a-f0-9]+)$/)){
      const g=db.galleries[x[2]],ph=g&&g.photos.find(f=>f.id===x[3]);if(!ph)return res.writeHead(404),res.end();
      const own=!!user&&g.owner===user.id;
      if(x[1]==='o'){if(!own)return res.writeHead(401),res.end();
        res.writeHead(200,{'Content-Disposition':'attachment; filename="'+ph.name+'"'});return fs.createReadStream(path.join(D,'originals',ph.id+'.bin')).pipe(res)}
      if(!own&&!active(userOf(g)))return res.writeHead(403),res.end();
      res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=3600'});return fs.createReadStream(path.join(D,'previews',ph.id+'.jpg')).pipe(res)}
    res.writeHead(404);res.end('Not found');
  }catch(e){console.error(e);json(res,500,{error:'Server error'})}
}).listen(PORT,()=>console.log('Running on http://localhost:'+PORT));
