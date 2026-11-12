# RETIRED (PR #23): Lovable-era script. It wrote to whatever VITE_SUPABASE_URL its .env named
# (possibly a hosted project), with no check of the target. Kept only as a record of what it
# verified; its checks are covered by scripts/security/permission_matrix.mjs and the SQL fixtures,
# which run only on databases the target guard accepts. Do not re-enable: rewrite it on the guard.
raise SystemExit("retired: this script has no target protection; see docs/operations/target-guard.md")
# Tenant-isolation regression check. 1) run create_test_accounts.py, 2) confirm A,B,M,S emails (not X) in the backend, 3) run this file, 4) delete the test accounts/orgs. Never run against real customer accounts.
import json,requests,re,uuid
env=dict(re.findall(r'^(\w+)="?([^"\n]*)"?',open('/dev-server/.env').read(),re.M))
U=env['VITE_SUPABASE_URL'];K=env['VITE_SUPABASE_PUBLISHABLE_KEY'];PW="Test-Pass-9271!"
E=json.load(open('/tmp/sec/emails.json'))
def H(t=None): return {"apikey":K,"Content-Type":"application/json",**({"Authorization":"Bearer "+t} if t else {})}
def login(e):
  r=requests.post(U+"/auth/v1/token?grant_type=password",headers=H(),json={"email":e,"password":PW}).json(); return r.get("access_token"), r.get("user",{}).get("id")
T={k:login(v) for k,v in E.items()}
def rpc(t,fn,body): r=requests.post(f"{U}/rest/v1/rpc/{fn}",headers=H(t),json=body); return r.status_code, r.text[:4000]
def get(t,path): r=requests.get(f"{U}/rest/v1/{path}",headers=H(t)); return r.status_code, r.text[:4000]
def post(t,path,body): r=requests.post(f"{U}/rest/v1/{path}",headers=H(t),json=body); return r.status_code, r.text[:4000]
def patch(t,path,body): r=requests.patch(f"{U}/rest/v1/{path}",headers={**H(t),"Prefer":"return=representation"},json=body); return r.status_code, r.text[:4000]
res=[]
def check(name,ok,detail): res.append(("PASS" if ok else "FAIL",name,detail))
a,aid=T["A"]; b,bid=T["B"]; m,mid=T["M"]; s,sid=T["S"]
check("unconfirmed user cannot sign in", T["X"][0] is None, "")
_,orgA=rpc(a,"create_organization",{"_name":"Sec Test A","_location_name":"A Store"}); orgA=json.loads(orgA)
if not isinstance(orgA,str): raise SystemExit("A reached the org limit; create fresh test accounts")
_,orgB=rpc(b,"create_organization",{"_name":"Sec Test B","_location_name":"B Store"}); orgB=json.loads(orgB)
if not isinstance(orgB,str): orgB=json.loads(get(b,"organization_members?select=org_id&role=eq.owner")[1])[0]["org_id"]
# invitations
_,tm=rpc(a,"create_invitation",{"_org_id":orgA,"_email":E["M"],"_role":"manager"}); tm=json.loads(tm)
_,ts=rpc(a,"create_invitation",{"_org_id":orgA,"_email":E["S"],"_role":"staff"}); ts=json.loads(ts)
c=rpc(b,"accept_invitation",{"_token":tm}); check("other email cannot accept invite", c[0]>=400 and "email_mismatch" in c[1], c)
check("manager accepts own invite", rpc(m,"accept_invitation",{"_token":tm})[0]==200, "")
check("staff accepts own invite", rpc(s,"accept_invitation",{"_token":ts})[0]==200, "")
c=rpc(s,"accept_invitation",{"_token":ts}); check("invite cannot be reused", c[0]>=400, c)
c=rpc(b,"get_invitation",{"_token":"deadbeef"*6}); check("guessed token reveals nothing", c[1].strip()=="[]", c)
# cross-tenant reads by ID
for tbl in ["organizations?id=eq.","locations?org_id=eq.","organization_members?org_id=eq.","invitations?org_id=eq.","audit_logs?org_id=eq."]:
  c=get(b,tbl+orgA); check(f"B cannot read A via {tbl.split('?')[0]}", c[1].strip()=="[]", c)
for tbl in ["organizations","locations","organization_members","invitations","audit_logs","profiles","user_roles"]:
  c=get(None,tbl+"?select=*"); check(f"anonymous cannot read {tbl}", c[0]>=400 or c[1].strip()=="[]", c)
c=get(b,"organizations?slug=eq.org_marao"); check("B cannot see MARAO", c[1].strip()=="[]", c)
c=rpc(b,"create_invitation",{"_org_id":orgA,"_email":"x@y.com","_role":"owner"}); check("B cannot invite into A", c[0]>=400, c)
c=rpc(b,"my_org_status",{"_org_id":orgA}); check("B cannot read A status", c[1].strip()=="[]", c)
# escalation
c=rpc(m,"create_invitation",{"_org_id":orgA,"_email":"o@y.com","_role":"owner"}); check("manager cannot invite owner", c[0]>=400, c)
c=rpc(s,"create_invitation",{"_org_id":orgA,"_email":"o@y.com","_role":"staff"}); check("staff cannot invite", c[0]>=400, c)
c=rpc(m,"transfer_ownership",{"_org_id":orgA,"_new_owner":mid}); check("manager cannot take ownership", c[0]>=400, c)
c=post(m,"organization_members",{"org_id":orgA,"user_id":mid,"role":"owner"}); check("direct membership insert blocked", c[0]>=400, c)
c=patch(m,f"organization_members?org_id=eq.{orgA}&user_id=eq.{mid}",{"role":"owner"}); check("direct role update blocked", c[0]>=400 or c[1].strip()=="[]", c)
c=post(b,"organization_members",{"org_id":orgA,"user_id":bid,"role":"owner"}); check("outsider cannot insert self into A", c[0]>=400, c)
c=post(a,"user_roles",{"user_id":aid,"role":"platform_admin"}); check("owner cannot self-grant platform admin", c[0]>=400, c)
c=patch(a,f"organizations?id=eq.{orgA}",{"store_limit":500,"status":"active"}); check("owner cannot change plan/limit directly", c[0]>=400 or c[1].strip()=="[]", c)
c=post(a,"audit_logs",{"org_id":orgA,"action":"fake"}); check("audit log cannot be forged", c[0]>=400, c)
for fn,body in [("admin_list_organizations",{}),("admin_list_audit",{}),("admin_assign_owner",{"_org_id":orgA,"_email":E["B"],"_verification_note":"xxxxxxxxxxxx"}),("admin_set_platform_role",{"_email":E["A"],"_role":"platform_admin","_grant":True,"_reason":"test"})]:
  c=rpc(a,fn,body); check(f"non-admin blocked from {fn}", c[0]>=400 and "forbidden" in c[1], c)
c=rpc(None,"create_organization",{"_name":"anon org"}); check("anonymous cannot create org", c[0]>=400, c)
c=rpc(a,"write_audit",{"_org":orgA,"_action":"x","_target":"x","_meta":{}}); check("write_audit not callable", c[0]>=400, c)
# store-level
c=get(s,f"locations?org_id=eq.{orgA}"); check("staff without store assignment sees no stores", c[1].strip()=="[]", c)
c=get(m,f"locations?org_id=eq.{orgA}"); check("manager without store assignment sees no stores", c[1].strip()=="[]", c)
# audit visibility
c=get(a,f"audit_logs?org_id=eq.{orgA}&select=action"); check("owner sees own audit trail", "invitation.accepted" in c[1], c)
c=get(s,f"audit_logs?org_id=eq.{orgA}"); check("staff cannot read audit", c[1].strip()=="[]", c)
# org cap
for i in range(3): last=rpc(b,"create_organization",{"_name":f"B extra {i}"})
check("org creation capped at 3 per user", last[0]>=400 and "org_limit" in last[1], last)
# --- Phase 1 additions ---
def J(c):
  try: return json.loads(c[1])
  except Exception: return None
c=rpc(a,"set_onboarding_step",{"_org_id":orgA,"_step":1}); check("onboarding cannot skip required branding", c[0]>=400 and "onboarding_brand_required" in c[1], c)
c=get(a,f"organizations?id=eq.{orgA}&select=onboarding_step"); check("refused onboarding step not written", '"onboarding_step":1' not in c[1], c)
# Trial plans allow one store, so the second store comes from org B (cross-tenant check).
L1=json.loads(get(a,f"locations?org_id=eq.{orgA}&select=id")[1])[0]["id"]
L2=json.loads(get(b,f"locations?org_id=eq.{orgB}&select=id")[1])[0]["id"]
c=rpc(a,"create_location",{"_org_id":orgA,"_name":"Sec Store 2","_address":"2 Test St","_timezone":"America/New_York","_phone":""}); check("trial store limit enforced", c[0]>=400 and "store_limit" in c[1], c)
mem0=json.loads(get(a,f"organization_members?org_id=eq.{orgA}&select=id,user_id")[1]); MID={x["user_id"]:x["id"] for x in mem0}
c=rpc(m,"update_location",{"_id":L1,"_name":"hack","_address":"x","_phone":"","_timezone":"America/New_York","_hours":{}}); check("manager cannot edit store before assignment", c[0]>=400, c)
c=rpc(a,"set_location_managers",{"_location_id":L1,"_member_ids":[MID[mid]]}); check("owner assigns manager to store 1", c[0] in (200,204), c)
c=get(m,f"locations?org_id=eq.{orgA}&select=id"); check("manager sees assigned store", L1 in c[1], c)
c=rpc(m,"update_location",{"_id":L2,"_name":"hack","_address":"x","_phone":"","_timezone":"America/New_York","_hours":{}}); check("manager cannot edit another org store", c[0]>=400, c)
c=get(b,f"locations?id=eq.{L2}&select=name"); check("other-org store unchanged", "hack" not in c[1], c)
c=rpc(a,"save_location_with_managers",{"_id":L1,"_name":"Sec Store 1","_address":"1 Test St","_phone":"","_timezone":"America/New_York","_hours":{"mon":{"open":"25:00","close":"02:00"}},"_member_ids":[]}); check("atomic save rolls back on invalid hours", c[0]>=400, c)
c=get(m,f"locations?org_id=eq.{orgA}&select=id"); check("rollback kept manager assignment", L1 in c[1], c)
c=rpc(a,"save_location_with_managers",{"_id":L1,"_name":"Sec Store 1","_address":"1 Test St","_phone":"","_timezone":"America/New_York","_hours":{"fri":{"open":"18:00","close":"02:00"}},"_member_ids":[MID[mid]]}); check("atomic save with overnight hours", c[0] in (200,204), c)
c=rpc(m,"set_member_role",{"_member_id":MID[mid],"_role":"owner"}); check("manager cannot promote self", c[0]>=400, c)
c=rpc(s,"set_member_role",{"_member_id":MID[sid],"_role":"manager"}); check("staff cannot change roles", c[0]>=400, c)
c=rpc(s,"set_member_locations",{"_member_id":MID[sid],"_location_ids":[L1,L2]}); check("staff cannot change store access", c[0]>=400, c)
c=rpc(a,"remove_member",{"_member_id":MID[aid]}); check("last owner cannot be removed", c[0]>=400, c)
c=get(a,f"organization_members?org_id=eq.{orgA}&role=eq.owner&select=id"); check("owner still present", MID[aid] in c[1], c)
inv=J(rpc(m,"create_invitation",{"_org_id":orgA,"_email":"staff2@example.com","_role":"staff","_location_ids":[L1]})); check("manager invites staff to own store", isinstance(inv,str), inv)
c=rpc(m,"create_invitation",{"_org_id":orgA,"_email":"staff3@example.com","_role":"staff","_location_ids":[L2]}); check("manager cannot invite to another org store", c[0]>=400, c)
c=get(a,f"invitations?org_id=eq.{orgA}&email=eq.staff3@example.com&select=id"); check("refused invite not written", c[1].strip()=="[]", c)
row=json.loads(get(a,f"invitations?org_id=eq.{orgA}&email=eq.staff2@example.com&select=id,location_ids,expires_at,created_at")[1])[0]
check("invite stores scoped", row["location_ids"]==[L1], row)
rv=J(rpc(a,"create_invitation",{"_org_id":orgA,"_email":E["B"],"_role":"staff"}))
rid=json.loads(get(a,f"invitations?org_id=eq.{orgA}&email=eq.{E['B'].lower()}&select=id")[1])
c=rpc(a,"revoke_invitation",{"_id":rid[0]["id"]}) if rid else (0,"no row"); check("owner revokes invite", c[0] in (200,204), c)
c=rpc(b,"accept_invitation",{"_token":rv}); check("revoked invite cannot be accepted", c[0]>=400, c)
c=get(b,f"organizations?id=eq.{orgA}"); check("revoked invitee has no access", c[1].strip()=="[]", c)
c=get(m,"organizations?select=id&slug=eq.org_marao"); check("manager cannot see MARAO", c[1].strip()=="[]", c)
# ownership handover
c=rpc(a,"transfer_ownership",{"_org_id":orgA,"_new_owner":mid}); check("owner can hand over to member", c[0] in (200,204), c)
c=get(m,f"organization_members?org_id=eq.{orgA}&select=user_id,role"); check("handover result: M owner, A manager", f'"{mid}","role":"owner"' in c[1] and f'"{aid}","role":"manager"' in c[1], c)
for r in res: print(*r[:2], "" if r[0]=="PASS" else r[2])
print(sum(r[0]=="PASS" for r in res),"/",len(res))
