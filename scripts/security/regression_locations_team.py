# RETIRED (PR #23): Lovable-era script. It wrote to whatever VITE_SUPABASE_URL its .env named
# (possibly a hosted project), with no check of the target. Kept only as a record of what it
# verified; its checks are covered by scripts/security/permission_matrix.mjs and the SQL fixtures,
# which run only on databases the target guard accepts. Do not re-enable: rewrite it on the guard.
raise SystemExit("retired: this script has no target protection; see docs/operations/target-guard.md")
# Regression: store creation, employee assignment, role changes, suspended orgs, admin bootstrap.
# Usage: run create_test_accounts.py, confirm A,B,M,S in the backend, then run phases 0..N:
#   python3 regression_locations_team.py <phase>  -> prints NEXT_SQL; the operator runs it with privileged
#   database access (subscription/plan state cannot be changed by app users), then runs the next phase.
# Delete the test accounts/orgs afterwards. Never run against real customer accounts.
import json,requests,re,sys
env=dict(re.findall(r'^(\w+)="?([^"\n]*)"?',open('/dev-server/.env').read(),re.M))
U=env['VITE_SUPABASE_URL'];K=env['VITE_SUPABASE_PUBLISHABLE_KEY'];PW="Test-Pass-9271!"
E=json.load(open('/tmp/sec/emails.json'))
def H(t=None): return {"apikey":K,"Content-Type":"application/json",**({"Authorization":"Bearer "+t} if t else {})}
def login(e):
  r=requests.post(U+"/auth/v1/token?grant_type=password",headers=H(),json={"email":e,"password":PW}).json(); return r.get("access_token"), r.get("user",{}).get("id")
T={k:login(v) for k,v in E.items() if k!="X"}
def rpc(t,fn,body): r=requests.post(f"{U}/rest/v1/rpc/{fn}",headers=H(t),json=body); return r.status_code, r.text[:600]
def get(t,path): r=requests.get(f"{U}/rest/v1/{path}",headers=H(t)); return r.status_code, r.text[:2000]
res=[]
def check(name,ok,detail=""): res.append(("PASS" if ok else "FAIL",name,"" if ok else detail)); print(res[-1])
a,aid=T["A"]; b,bid=T["B"]; m,mid=T["M"]; s,sid=T["S"]
J=lambda c: json.loads(c[1])

KEYS=["orgA","orgB","L1","L2","L3","MID"]
P=int(sys.argv[1]); SF="/tmp/sec/reg_state.json"
if P>0: globals().update(json.load(open(SF)))
SQLS=[lambda: f"update subscriptions set plan_id='growth' where org_id='{orgA}'",lambda: f"update subscriptions set plan_id='starter' where org_id='{orgA}'",lambda: f"update organizations set store_limit_override=5 where id='{orgA}'; select sync_org_entitlements('{orgA}')",lambda: f"update organizations set store_limit_override=null where id='{orgA}'; update subscriptions set plan_id='growth', trial_ends_at=now()-interval '1 day' where org_id='{orgA}'",lambda: f"update subscriptions set status='canceled', trial_ends_at=now()+interval '14 days' where org_id='{orgA}'",lambda: f"update subscriptions set status='unpaid' where org_id='{orgA}'",lambda: f"update subscriptions set status='grace', grace_ends_at=now()-interval '1 hour' where org_id='{orgA}'",lambda: f"update subscriptions set status='trialing', grace_ends_at=null where org_id='{orgA}'",lambda: f"update organizations set status='suspended' where id='{orgA}'"]
if P==0:
  orgA=J(rpc(a,"create_organization",{"_name":"Reg Test A"})); c=rpc(b,"create_organization",{"_name":"Reg Test B"}); orgB=J(c) if c[0]==200 else json.loads(get(b,"organizations?select=id&limit=1")[1])[0]["id"]
  locs=json.loads(get(a,f"locations?org_id=eq.{orgA}&select=id")[1]); L1=locs[0]["id"]
  # plan entitlements: Starter trial = 1 store (from billing_plans), not a hardcoded 3
  c=get(a,f"organizations?id=eq.{orgA}&select=store_limit,plan"); check("new org gets plan allowance (starter=1)", '"store_limit":1' in c[1], c)
  c=rpc(a,"create_location",{"_org_id":orgA,"_name":"Second","_address":"1 Main St","_timezone":"America/New_York","_phone":""}); check("starter blocks 2nd store", "store_limit" in c[1], c)
  pass
if P==1:
  c=get(a,f"organizations?id=eq.{orgA}&select=store_limit,plan"); check("upgrade raises allowance (growth=3)", '"store_limit":3' in c[1] and "growth" in c[1], c)
  c=rpc(a,"create_location",{"_org_id":orgA,"_name":"Second","_address":"1 Main St","_timezone":"America/New_York","_phone":""}); check("owner creates store after upgrade", c[0] in (200,204), c); L2=J(c)
  c=rpc(a,"create_location",{"_org_id":orgA,"_name":"Bad tz","_address":"","_timezone":"Mars/Base","_phone":""}); check("invalid timezone rejected", "invalid_timezone" in c[1], c)
  c=rpc(a,"create_location",{"_org_id":orgA,"_name":"Third","_address":"","_timezone":"America/Chicago","_phone":""}); L3=J(c)
  c=rpc(a,"create_location",{"_org_id":orgA,"_name":"Fourth","_address":"","_timezone":"America/Chicago","_phone":""}); check("growth limit enforced in backend", "store_limit" in c[1], c)
  c=rpc(a,"set_location_status",{"_id":L3,"_status":"inactive"}); check("owner deactivates store", c[0] in (200,204), c)
  c=rpc(a,"create_location",{"_org_id":orgA,"_name":"Fourth","_address":"","_timezone":"America/Chicago","_phone":""}); check("inactive store frees a slot", c[0] in (200,204), c)
  rpc(a,"update_location",{"_id":L3,"_name":"Third","_address":"3 Main St","_phone":"","_timezone":"America/Chicago","_hours":{}})
  c=rpc(a,"set_location_status",{"_id":L3,"_status":"active"}); check("reactivation respects limit", "store_limit" in c[1], c)
  pass
if P==2:
  c=get(a,f"locations?org_id=eq.{orgA}&status=eq.active&select=id"); check("downgrade keeps existing stores", len(json.loads(c[1]))==3, c)
  c=rpc(a,"set_location_status",{"_id":L3,"_status":"active"}); check("downgrade blocks reactivation over limit", "store_limit" in c[1], c)
  pass
if P==3:
  c=get(a,f"organizations?id=eq.{orgA}&select=store_limit"); check("operator override applies", '"store_limit":5' in c[1], c)
  pass
if P==4:
  c=rpc(a,"update_location",{"_id":L3,"_name":"T","_address":"3 Main St","_phone":"","_timezone":"America/Chicago","_hours":{}}); check("expired trial blocks writes", "subscription_inactive" in c[1], c)
  pass
if P==5:
  c=rpc(a,"update_location",{"_id":L3,"_name":"T","_address":"3 Main St","_phone":"","_timezone":"America/Chicago","_hours":{}}); check("canceled subscription blocks writes", "subscription_inactive" in c[1], c)
  pass
if P==6:
  c=rpc(a,"set_location_status",{"_id":L2,"_status":"inactive"}); check("unpaid subscription blocks writes", "subscription_inactive" in c[1], c)
  pass
if P==7:
  c=rpc(a,"set_location_status",{"_id":L2,"_status":"inactive"}); check("expired grace blocks writes", "subscription_inactive" in c[1], c)
  pass
if P==8:
  c=rpc(b,"create_location",{"_org_id":orgA,"_name":"Evil","_address":"","_timezone":"America/Chicago","_phone":""}); check("other tenant cannot add store", "forbidden" in c[1], c)
  c=rpc(b,"update_location",{"_id":L1,"_name":"Hacked","_address":"","_phone":"","_timezone":"America/Chicago","_hours":{}}); check("other tenant cannot edit store", "forbidden" in c[1], c)
  c=rpc(None,"create_location",{"_org_id":orgA,"_name":"Anon","_address":"","_timezone":"America/Chicago","_phone":""}); check("anonymous cannot add store", c[0]>=400, c)
  # members
  tm=J(rpc(a,"create_invitation",{"_org_id":orgA,"_email":E["M"],"_role":"manager","_location_ids":[L1]}))
  rpc(m,"accept_invitation",{"_token":tm})
  c=rpc(m,"create_location",{"_org_id":orgA,"_name":"Mgr store","_address":"","_timezone":"America/Chicago","_phone":""}); check("manager cannot add store", "forbidden" in c[1], c)
  c=rpc(m,"create_invitation",{"_org_id":orgA,"_email":E["S"],"_role":"manager","_location_ids":[L1]}); check("manager cannot invite manager", "forbidden" in c[1], c)
  c=rpc(m,"create_invitation",{"_org_id":orgA,"_email":E["S"],"_role":"staff","_location_ids":[L2]}); check("manager cannot invite into other store", "forbidden" in c[1], c)
  c=rpc(m,"create_invitation",{"_org_id":orgA,"_email":E["S"],"_role":"staff","_location_ids":[L1]}); check("manager invites staff into own store", c[0] in (200,204), c)
  rpc(s,"accept_invitation",{"_token":J(c)})
  mem=json.loads(get(a,f"organization_members?org_id=eq.{orgA}&select=id,user_id,role")[1]); MID={x["user_id"]:x["id"] for x in mem}
  c=get(s,f"locations?org_id=eq.{orgA}&select=id"); check("staff sees only assigned store", json.loads(c[1])==[{"id":L1}], c)
  c=get(m,f"locations?org_id=eq.{orgA}&select=id"); check("manager sees only assigned store", json.loads(c[1])==[{"id":L1}], c)
  c=rpc(m,"set_member_locations",{"_member_id":MID[sid],"_location_ids":[L1,L2]}); check("manager cannot assign staff outside scope", "forbidden" in c[1], c)
  c=rpc(s,"set_member_locations",{"_member_id":MID[sid],"_location_ids":[L1,L2]}); check("staff cannot self-assign stores", "forbidden" in c[1], c)
  c=rpc(a,"set_member_locations",{"_member_id":MID[sid],"_location_ids":[L1,L2]}); check("owner assigns staff stores", c[0] in (200,204), c)
  c=rpc(m,"remove_member",{"_member_id":MID[sid]}); check("manager cannot remove staff outside scope", "forbidden" in c[1], c)
  c=rpc(b,"set_member_locations",{"_member_id":MID[sid],"_location_ids":[]}); check("other tenant cannot assign", "forbidden" in c[1], c)
  # roles
  c=rpc(s,"set_member_role",{"_member_id":MID[sid],"_role":"owner"}); check("staff cannot elevate self", "forbidden" in c[1], c)
  c=rpc(m,"set_member_role",{"_member_id":MID[mid],"_role":"owner"}); check("manager cannot elevate self", "forbidden" in c[1], c)
  c=rpc(m,"set_member_role",{"_member_id":MID[sid],"_role":"manager"}); check("manager cannot change roles", "forbidden" in c[1], c)
  c=rpc(a,"set_member_role",{"_member_id":MID[aid],"_role":"manager"}); check("last owner protected (demote)", "last_owner" in c[1], c)
  c=rpc(a,"remove_member",{"_member_id":MID[aid]}); check("last owner protected (leave)", "last_owner" in c[1], c)
  c=rpc(a,"set_member_role",{"_member_id":MID[sid],"_role":"manager"}); check("owner changes role", c[0] in (200,204), c)
  c=rpc(a,"set_location_managers",{"_location_id":L2,"_member_ids":[MID[mid]]}); check("owner assigns store manager", c[0] in (200,204), c)
  c=rpc(m,"set_location_managers",{"_location_id":L2,"_member_ids":[]}); check("manager cannot reassign managers", "forbidden" in c[1], c)
  # billing + audit
  c=get(m,f"subscriptions?org_id=eq.{orgA}"); check("manager cannot read billing", c[1].strip()=="[]", c)
  c=get(b,f"subscriptions?org_id=eq.{orgA}"); check("other tenant cannot read billing", c[1].strip()=="[]", c)
  c=get(a,f"subscriptions?org_id=eq.{orgA}&select=status"); check("owner reads own subscription", "trialing" in c[1], c)
  c=rpc(a,"admin_set_subscription",{"_org_id":orgA,"_plan":"enterprise","_status":"active","_reason":"self upgrade"}); check("owner cannot change own plan", "forbidden" in c[1], c)
  c=get(a,f"audit_logs?org_id=eq.{orgA}&select=action"); acts=c[1]
  for act in ["location.created","location.status_changed","member.locations_changed","member.role_changed","location.managers_changed"]:
    check(f"audited: {act}", act in acts, "")
  # privileged tables
  def wr(t,method,path,body=None):
    r=requests.request(method,f"{U}/rest/v1/{path}",headers={**H(t),"Prefer":"return=representation"},json=body); return r.status_code,r.text[:300]
  c=wr(a,"PATCH",f"subscriptions?org_id=eq.{orgA}",{"status":"active","plan_id":"enterprise"}); check("owner cannot write subscription", c[0]>=400 or c[1].strip()=="[]", c)
  c=wr(a,"POST","billing_events",{"org_id":orgA,"kind":"invoice.paid","amount_cents":1}); check("owner cannot fabricate payment history", c[0]>=400, c)
  c=wr(a,"POST","subscriptions",{"org_id":orgB,"plan_id":"enterprise"}); check("cannot insert subscriptions", c[0]>=400, c)
  c=wr(a,"PATCH",f"billing_plans?id=eq.starter",{"default_store_limit":99}); check("cannot edit plans", c[0]>=400 or c[1].strip()=="[]", c)
  c=wr(a,"PATCH",f"organizations?id=eq.{orgA}",{"store_limit_override":99}); check("owner cannot set own override", c[0]>=400 or c[1].strip()=="[]", c)
  for tb in ["stripe_webhook_events","platform_bootstrap"]:
    c=get(a,tb+"?select=*"); check(f"users cannot read {tb}", c[0]>=400 or c[1].strip()=="[]", c)
    c=get(None,tb+"?select=*"); check(f"anon cannot read {tb}", c[0]>=400 or c[1].strip()=="[]", c)
  c=wr(a,"POST","stripe_webhook_events",{"id":"evt_x","type":"x"}); check("users cannot pre-seed webhook ids", c[0]>=400, c)
  c=rpc(a,"billing_apply_stripe_event",{"_event_id":"evt_fake","_type":"invoice.paid","_org_id":orgA,"_customer":None,"_subscription":None,"_status":"active","_plan":"enterprise","_period_start":None,"_period_end":None,"_cancel_at_period_end":None,"_amount_cents":100,"_currency":"usd"}); check("users cannot apply Stripe events", c[0]>=400, c)
  c=rpc(a,"admin_update_organization",{"_org_id":orgA,"_status":None,"_plan":"enterprise","_store_limit":50,"_reason":"self"}); check("owner cannot call admin plan change", "forbidden" in c[1], c)
  c=get(b,f"billing_events?org_id=eq.{orgA}"); check("other tenant cannot read payments", c[1].strip()=="[]", c)
  # bootstrap
  c=rpc(a,"bootstrap_first_platform_admin",{"_user_id":aid,"_authorization_note":"trying to self-bootstrap"}); check("bootstrap not callable by users", c[0]>=400, c)
  c=rpc(None,"bootstrap_first_platform_admin",{"_user_id":aid,"_authorization_note":"trying to self-bootstrap"}); check("bootstrap not callable anonymously", c[0]>=400, c)
  print("ORG_A", orgA)
  pass
if P==9:
  L1=json.loads(get(a,f"locations?org_id=eq.{orgA}&select=id&limit=1")[1])[0]["id"]
  c=rpc(a,"create_location",{"_org_id":orgA,"_name":"While suspended","_address":"","_timezone":"America/Chicago","_phone":""}); check("suspended: cannot add store", "org_suspended" in c[1], c)
  c=rpc(a,"update_location",{"_id":L1,"_name":"Edit","_address":"","_phone":"","_timezone":"America/Chicago","_hours":{}}); check("suspended: cannot edit store", "org_suspended" in c[1], c)
  c=rpc(a,"create_invitation",{"_org_id":orgA,"_email":"z@example.com","_role":"staff","_location_ids":[]}); check("suspended: cannot invite", "org_suspended" in c[1], c)
  mem=json.loads(get(a,f"organization_members?org_id=eq.{orgA}&select=id,role")[1]); st=[x for x in mem if x["role"]!="owner"][0]["id"]
  c=rpc(a,"set_member_role",{"_member_id":st,"_role":"staff"}); check("suspended: cannot change roles", "org_suspended" in c[1], c)
  c=rpc(a,"set_member_locations",{"_member_id":st,"_location_ids":[]}); check("suspended: cannot assign stores", "org_suspended" in c[1], c)
  c=rpc(a,"can_operate_location",{"_location_id":L1}); check("suspended: can_operate_location false", c[1].strip()=="false", c)

  pass
json.dump({k:globals()[k] for k in KEYS if k in globals()},open(SF,"w"))
if P<len(SQLS): print("NEXT_SQL:", SQLS[P]())
print(f"\n{sum(r[0]=='PASS' for r in res)}/{len(res)} passed"); [print(r) for r in res if r[0]=="FAIL"]
