# RETIRED (PR #23): Lovable-era script. It wrote to whatever VITE_SUPABASE_URL its .env named
# (possibly a hosted project), with no check of the target. Kept only as a record of what it
# verified; its checks are covered by scripts/security/permission_matrix.mjs and the SQL fixtures,
# which run only on databases the target guard accepts. Do not re-enable: rewrite it on the guard.
raise SystemExit("retired: this script has no target protection; see docs/operations/target-guard.md")
# Run only on a persisted fictional Growth test org with a Juniper Downtown store.
# Supply owner/outsider minted-session file paths, TEST_ORG_ID and TEST_INVITEE_EMAIL.
# Creates a scoped invitation and toggles the test store inactive/active; never targets real tenants.
import json,re,requests,os,sys
from pathlib import Path
v=dict(re.findall(r'^(\w+)="?([^"\n]*)"?',Path('/dev-server/.env').read_text(),re.M));u=v['VITE_SUPABASE_URL'];k=v['VITE_SUPABASE_PUBLISHABLE_KEY'];a=json.load(open(os.environ['TEST_OWNER_SESSION_FILE']))['session']['access_token'];s=json.load(open(os.environ['TEST_OUTSIDER_SESSION_FILE']))['session']['access_token'];org=os.environ['TEST_ORG_ID'];res=[]
def req(t,fn,body):return requests.post(u+'/rest/v1/rpc/'+fn,headers={'apikey':k,**({'Authorization':'Bearer '+t} if t else {})},json=body)
def read(t,path):return requests.get(u+'/rest/v1/'+path,headers={'apikey':k,**({'Authorization':'Bearer '+t} if t else {})})
def check(n,ok):res.append((n,bool(ok)));print('PASS' if ok else 'FAIL',n)
for fn,args in [('admin_org_insights',{}),('admin_list_organizations',{}),('admin_list_audit',{}),('save_org_brand',{'_org_id':org,'_primary':'#16707a','_accent':'#e04796'}),('set_onboarding_step',{'_org_id':org,'_step':5}),('create_location',{'_org_id':org,'_name':'Intruder','_address':'','_timezone':'America/New_York','_phone':''})]:
 r=req(s,fn,args);check('regular outsider denied '+fn,r.status_code>=400)
check('regular cannot read Juniper',read(s,'organizations?id=eq.'+org).json()==[])
check('regular cannot read MARAO',read(s,'organizations?slug=eq.org_marao').json()==[])
check('regular has no platform role',req(s,'is_platform_admin',{}).json()==False)
check('admin role preserved',req(a,'is_platform_admin',{}).json()==True)
check('admin cannot read MARAO without membership',read(a,'organizations?slug=eq.org_marao').json()==[])
locs=read(a,'locations?org_id=eq.'+org+'&select=id,name,address,status').json();loc=next(x['id'] for x in locs if x['name']=='Juniper Downtown')
check('store edit persisted',any(x['address']=='100 Fictional Avenue' for x in locs))
check('Growth allowance is three',read(a,'organizations?id=eq.'+org+'&select=store_limit').json()[0]['store_limit']==3)
check('owner deactivates',req(a,'set_location_status',{'_id':loc,'_status':'inactive'}).status_code in (200,204))
check('owner reactivates within Growth',req(a,'set_location_status',{'_id':loc,'_status':'active'}).status_code in (200,204))
check('invalid color refused','invalid_color' in req(a,'save_org_brand',{'_org_id':org,'_primary':'invalid','_accent':'#e04796'}).text)
check('SVG markup refused','invalid_logo' in req(a,'save_org_brand',{'_org_id':org,'_primary':'#16707a','_accent':'#e04796','_logo':'data:image/svg+xml;base64,AAAA'}).text)
check('anonymous brand write denied',req(None,'save_org_brand',{'_org_id':org,'_primary':'#16707a','_accent':'#e04796'}).status_code>=400)
r=req(a,'create_invitation',{'_org_id':org,'_email':os.environ['TEST_INVITEE_EMAIL'],'_role':'staff','_location_ids':[loc]});check('scoped invitation created',r.status_code in (200,204))
if r.status_code in (200,204):
 token=r.json();r=req(s,'accept_invitation',{'_token':token});check('unconfirmed invitee rejected',r.status_code>=400);print('invitation acceptance deferred: test email is unconfirmed')
acts=read(a,'audit_logs?org_id=eq.'+org+'&select=action').json();check('branding writes audited',any(x['action']=='organization.brand_updated' for x in acts));check('locations audited',any(x['action']=='location.status_changed' for x in acts))
print(sum(x[1] for x in res),'/',len(res));sys.exit(0 if all(x[1] for x in res) else 1)
