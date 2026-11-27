// Executes the client-preview dataset (scripts/preview/dataset.mjs) on a destination checked by
// scripts/preview/client-preview-target.mjs. Three entry points:
//   seed      first run: demo accounts, personal owners, organization, stores, team, operational data;
//   reset     keeps the organization, its stores, every member (personal owners included) and their
//             store assignments, and replaces only the operational data (client_preview_purge_operational);
//   teardown  removes everything: the organization, the demo accounts and the personal owners' accounts.
// Writes only:
//   * through the same RPCs as the UI, signed in as the demo owner (organization, stores, menu, stock,
//     recipes, suppliers, expenses, purchases + receipts, POS sales, kitchen statuses, invitations),
//     so prices, tax, stock, COGS, payments and the ledger come from the server;
//   * with the server key, what the UI cannot do on a demo: confirmed accounts (Auth admin API), the
//     demo subscription (Growth, active, no billing provider, as scripts/seeds/demo/seed-demo-orgs.sql),
//     and the functions of scripts/preview/sql/client-preview-functions.sql (demo organization only).
// Personal owners (scripts/preview/personal-owners.mjs): at most two real people, each with an
// individual account, made Owner of the demo organization only through create_invitation +
// accept_invitation, with a one-time password that is never stored or printed (each person then sets
// their own password through an individual recovery link: scripts/preview/personal-access-link.mjs).
// Never a platform role. Before writing anything, every run refuses a database that holds any account
// outside the demo domain and the declared personal owners, or any platform role.
// Demo-account passwords are written only to the credentials file (outside the repository, mode 600);
// personal owners' passwords are never written anywhere, and their addresses are never logged.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assertResolvedTarget } from "./client-preview-target.mjs";
import { personalLabel } from "./personal-owners.mjs";
import {
  ACCOUNTS,
  buildDataset,
  CATEGORIES,
  DATASET_VERSION,
  EMAIL_DOMAIN,
  ORG,
  PRODUCTS,
  STOCK,
  STORES,
  SUPPLIERS,
  TIMEZONE,
} from "./dataset.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(ROOT, "package.json"));
const { createClient } = require("@supabase/supabase-js");
const NIL = "00000000-0000-0000-0000-000000000000";
const iso = (ms) => new Date(ms).toISOString();

export class SeedError extends Error {}

export function assertCredsFileOutsideRepo(file) {
  if (!file) throw new SeedError("PREVIEW_CREDS_FILE is required (a path outside the repository)");
  const abs = path.resolve(file);
  const rel = path.relative(ROOT, abs);
  if (!rel.startsWith("..") && !path.isAbsolute(rel))
    throw new SeedError("the credentials file must be outside the repository");
  return abs;
}

function clients(target) {
  assertResolvedTarget(target);
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const svc = createClient(target.apiUrl, target.serviceKey, opts);
  const signIn = async (email, password) => {
    const c = createClient(target.apiUrl, target.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new SeedError(`sign-in ${email}: ${error.message}`);
    return c;
  };
  return { svc, signIn };
}

const transient = (e) =>
  /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(String(e?.message ?? e));
/** RPC call. `idempotent` calls are retried on network errors only (never on a server answer). */
async function rpc(client, fn, args, { idempotent = false } = {}) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await client.rpc(fn, args);
    } catch (e) {
      if (idempotent && attempt < 4 && transient(e)) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      throw e;
    }
    if (res.error) {
      if (idempotent && attempt < 4 && transient(res.error)) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      throw new SeedError(
        `${fn}: ${res.error.message}${res.error.details ? ` (${res.error.details})` : ""}`,
      );
    }
    return res.data;
  }
}
async function must(promise, what) {
  const { data, error } = await promise;
  if (error) throw new SeedError(`${what}: ${error.message}`);
  return data;
}

async function allUsers(svc) {
  const found = [];
  for (let page = 1; page < 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new SeedError(`listUsers: ${error.message}`);
    found.push(...data.users);
    if (data.users.length < 200) break;
  }
  return found;
}
const isDemoAccount = (u) => (u.email ?? "").toLowerCase().endsWith(`@${EMAIL_DOMAIN}`);
async function demoOrganizations(svc) {
  return must(
    svc.from("organizations").select("id,slug").eq("name", ORG.name).eq("is_demo", true),
    "organizations",
  );
}

const hoursOf = (store) => {
  const pad = (n) => String(n).padStart(2, "0");
  const span = {
    open: `${pad(store.open[0])}:${pad(store.open[1])}`,
    close: `${pad(store.close[0])}:${pad(store.close[1])}`,
  };
  return Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, span]),
  );
};

const newPassword = () => `${crypto.randomBytes(15).toString("base64url")}!7a`;

/**
 * Refuses (before any write) a database that holds an account outside the demo domain and the declared
 * personal owners, or any platform role. Returns the users classified.
 */
async function auditAccounts(svc, personalOwners) {
  const users = await allUsers(svc);
  const outside = users.filter((u) => {
    const email = (u.email ?? "").toLowerCase();
    if (isDemoAccount(u)) return false;
    if (personalOwners.includes(email)) return false;
    return true; // any other account (real or another test domain) is not part of the preview
  });
  if (outside.length)
    throw new SeedError(
      `the database has ${outside.length} account(s) outside the demo domain and the declared personal owners; nothing was written`,
    );
  const { count, error } = await svc
    .from("user_roles")
    .select("id", { count: "exact", head: true });
  if (error) throw new SeedError(`user_roles: ${error.message}`);
  if (count)
    throw new SeedError(
      `the database has ${count} platform role(s); the preview has no platform admin`,
    );
  return {
    demo: users.filter(isDemoAccount),
    personal: users.filter((u) => personalOwners.includes((u.email ?? "").toLowerCase())),
  };
}

async function members(svc, orgId) {
  return must(
    svc.from("organization_members").select("id,user_id,role").eq("org_id", orgId),
    "members",
  );
}

/** Removes everything: the demo organization(s), the demo accounts and the personal owners' accounts. */
export async function teardownClientPreview(target, { log = console.log } = {}) {
  const { svc } = clients(target);
  const { demo, personal } = await auditAccounts(svc, target.personalOwners);
  const removed = [];
  for (const org of await demoOrganizations(svc))
    removed.push(await rpc(svc, "client_preview_purge", { _org_id: org.id }));
  for (const u of [...demo, ...personal]) {
    const { error } = await svc.auth.admin.deleteUser(u.id);
    if (error) throw new SeedError(`deleteUser: ${error.message}`);
  }
  log(
    `teardown: ${removed.length} demo organization(s), ${demo.length} demo account(s) and ${personal.length} personal owner account(s) removed`,
  );
  return { organizations: removed, demoAccounts: demo.length, personalAccounts: personal.length };
}

/** First run. Refuses when the demo organization or any preview account already exists. */
export function seedClientPreview(target, options = {}) {
  return run(target, { ...options, mode: "seed" });
}

/**
 * Replaces the operational data and keeps the organization, stores, members and personal owners.
 * On a database without the demo organization it seeds it (only when no preview account exists).
 */
export function resetClientPreview(target, options = {}) {
  return run(target, { ...options, mode: "reset" });
}

async function run(
  target,
  {
    mode,
    now = Date.now(),
    profile = "ledger-safe",
    credsFile,
    log = console.log,
    concurrency = 3,
  },
) {
  const credsPath = assertCredsFileOutsideRepo(credsFile);
  const { svc, signIn } = clients(target);
  const owners = target.personalOwners;
  const audit = await auditAccounts(svc, owners);
  const orgs = await demoOrganizations(svc);
  if (orgs.length > 1) throw new SeedError("more than one demo organization (run teardown)");
  const existing = orgs[0] ?? null;
  if (mode === "seed" && existing)
    throw new SeedError("the demo organization already exists (use reset)");
  if (!existing && (audit.demo.length || audit.personal.length))
    throw new SeedError(
      "preview accounts exist without the demo organization (run teardown first)",
    );

  const plan = buildDataset({ now, profile });
  log(
    `${existing ? "reset" : "seed"}: dataset profile ${profile}, ${plan.summary.orders} orders over ${plan.summary.days + 1} days, ~${plan.summary.ledgerEntries} ledger entries; ${owners.length} personal owner(s) declared`,
  );
  const started = Date.now();
  const byEmail = new Map(audit.demo.map((u) => [u.email.toLowerCase(), u]));
  // Demo passwords are kept across resets: an existing demo account keeps the password recorded in
  // the credentials file, which is checked by signing in BEFORE anything is written (Auth included);
  // its password is never set again. PREVIEW_ROTATE_DEMO_PASSWORDS=1 is the explicit recovery path
  // for a lost credentials file (new passwords for the demo accounts only).
  const rotate = process.env.PREVIEW_ROTATE_DEMO_PASSWORDS === "1";
  const kept = {};
  let previous = null;
  if (!rotate && ACCOUNTS.some((a) => byEmail.has(a.email))) {
    try {
      previous = JSON.parse(fs.readFileSync(credsPath, "utf8"));
    } catch {
      previous = null;
    }
    if (previous?.kind !== "dinequora-client-preview" || previous.apiUrl !== target.apiUrl)
      throw new SeedError(
        "the demo accounts exist but the credentials file is missing or belongs to another destination; the reset keeps the demo passwords and needs that file (nothing was changed)",
      );
    for (const a of ACCOUNTS) {
      const found = byEmail.get(a.email);
      if (!found) continue;
      const p = previous.accounts?.[a.key];
      if (!p?.password || p.email !== a.email || p.userId !== found.id)
        throw new SeedError(
          `the credentials file has no current password for the demo ${a.key} account; nothing was changed`,
        );
      try {
        // scope "local": ends only the session opened by this check, never the account's other sessions
        await (await signIn(a.email, p.password)).auth.signOut({ scope: "local" });
      } catch {
        throw new SeedError(
          `the demo ${a.key} account does not accept the password of the credentials file; nothing was changed`,
        );
      }
      kept[a.key] = p.password;
    }
  }
  // On a reset the file starts as the previous one (organization, stores, last seed summary), so a
  // run that stops before the end leaves a complete, still accurate file.
  const creds = {
    ...(Object.keys(kept).length ? previous : {}),
    kind: "dinequora-client-preview",
    datasetVersion: DATASET_VERSION,
    target: target.where,
    apiUrl: target.apiUrl,
    // Kept passwords are in the file from the first write, so an interrupted run never loses them.
    accounts: Object.fromEntries(
      ACCOUNTS.filter((a) => kept[a.key]).map((a) => [
        a.key,
        { email: a.email, password: kept[a.key], userId: byEmail.get(a.email).id, role: a.role },
      ]),
    ),
  };
  const save = () => fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  // The credentials file must be writable before anything is created, or passwords would be lost.
  try {
    save();
  } catch (e) {
    throw new SeedError(`cannot write the credentials file (${e.code ?? e.message})`);
  }

  // 1. Demo accounts: created on the first run; on a reset they keep their password (above) and only
  //    get the dataset's display name when it differs.
  for (const a of ACCOUNTS) {
    const found = byEmail.get(a.email);
    const password = kept[a.key] ?? newPassword();
    let userId;
    if (found) {
      // A kept demo account (reserved .test domain only, never a personal owner).
      if (!kept[a.key]) {
        // Explicit rotation only (PREVIEW_ROTATE_DEMO_PASSWORDS=1).
        const { error } = await svc.auth.admin.updateUserById(found.id, { password });
        if (error) throw new SeedError(`updateUser ${a.key}: ${error.message}`);
      }
      if (found.user_metadata?.full_name !== a.fullName) {
        const { error } = await svc.auth.admin.updateUserById(found.id, {
          user_metadata: { ...(found.user_metadata ?? {}), full_name: a.fullName },
        });
        if (error) throw new SeedError(`display name ${a.key}: ${error.message}`);
      }
      const profile = await must(
        svc.from("profiles").select("full_name").eq("id", found.id).maybeSingle(),
        `profile ${a.key}`,
      );
      if (profile?.full_name !== a.fullName) {
        const { error: nameError } = await svc
          .from("profiles")
          .update({ full_name: a.fullName })
          .eq("id", found.id);
        if (nameError) throw new SeedError(`display name ${a.key}: ${nameError.message}`);
      }
      userId = found.id;
    } else {
      const { data, error } = await svc.auth.admin.createUser({
        email: a.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: a.fullName, preferred_language: "en-US" },
      });
      if (error) throw new SeedError(`createUser ${a.key}: ${error.message}`);
      userId = data.user.id;
    }
    creds.accounts[a.key] = { email: a.email, password, userId, role: a.role };
    save();
  }
  const owner = await signIn(creds.accounts.owner.email, creds.accounts.owner.password);

  // 2. Organization and stores: created on the first run (onboarding path, classified as demo),
  //    reused on a reset. Plan, brand, tax and hours are written by the first seed only.
  let orgId;
  const loc = {};
  if (existing) {
    orgId = existing.id;
    const m = (await members(svc, orgId)).find((x) => x.user_id === creds.accounts.owner.userId);
    if (m?.role !== "owner")
      throw new SeedError("the demo owner is not an owner of the demo organization");
    const found = await must(
      owner.from("locations").select("id,name").eq("org_id", orgId),
      "stores",
    );
    for (const s of STORES) {
      const l = found.find((x) => x.name === s.name);
      if (!l) throw new SeedError(`store ${s.name} is missing (run teardown, then seed)`);
      loc[s.key] = l.id;
    }
  } else {
    orgId = await rpc(owner, "create_test_restaurant", {
      _name: ORG.name,
      _company_name: ORG.companyName,
      _company_address: ORG.companyAddress,
      _location_name: STORES[0].name,
    });
  }
  // A reset keeps the organization's settings exactly as people left them: brand colours and logo,
  // store names, addresses, phones, hours, time zone and tax rate, and the subscription. Only the
  // first seed writes them. The dataset still needs what it was planned for (sales are recorded at
  // the store's configured tax rate, in the dataset's time zone, in active stores, under an active
  // subscription for three stores), so a reset checks that before anything is removed and stops
  // instead of overwriting a setting someone changed.
  if (existing) {
    const sub = await must(
      svc.from("subscriptions").select("status").eq("org_id", orgId).maybeSingle(),
      "subscription",
    );
    if (sub?.status !== "active")
      throw new SeedError(
        "the demo subscription is not active; the reset keeps it as it is and stops",
      );
  } else
    await must(
      svc
        .from("subscriptions")
        .update({
          plan_id: ORG.plan,
          status: "active",
          trial_ends_at: null,
          grace_ends_at: null,
          billed_locations: STORES.length,
        })
        .eq("org_id", orgId),
      "demo subscription",
    );
  const limit = await rpc(svc, "effective_store_limit", { _org_id: orgId });
  if (limit < STORES.length) throw new SeedError(`store limit ${limit} < ${STORES.length}`);
  if (!existing)
    await rpc(owner, "save_org_brand", {
      _org_id: orgId,
      _primary: ORG.brandPrimary,
      _accent: ORG.brandAccent,
      _logo: null,
    });
  const org = await must(
    owner.from("organizations").select("slug").eq("id", orgId).single(),
    "org slug",
  );
  if (!existing) {
    const first = await must(
      owner.from("locations").select("id").eq("org_id", orgId),
      "first store",
    );
    if (first.length !== 1) throw new SeedError("expected exactly one store after onboarding");
    loc[STORES[0].key] = first[0].id;
    for (const s of STORES.slice(1))
      loc[s.key] = await rpc(owner, "create_location_with_tax_rate", {
        _org_id: orgId,
        _name: s.name,
        _address: s.address,
        _timezone: TIMEZONE,
        _phone: s.phone,
        _tax_rate_ppm: s.taxRatePpm,
      });
  }
  if (existing) {
    const stored = await must(
      svc.from("locations").select("id,status,timezone,tax_rate_ppm").eq("org_id", orgId),
      "store settings",
    );
    for (const s of STORES) {
      const l = stored.find((x) => x.id === loc[s.key]);
      if (l?.status !== "active" || l.timezone !== TIMEZONE || l.tax_rate_ppm !== s.taxRatePpm)
        throw new SeedError(
          `store ${s.name}: status, time zone or tax rate differs from the dataset; the reset keeps the store as it is and stops before removing anything`,
        );
    }
  } else
    for (const s of STORES) {
      await rpc(owner, "set_location_tax_rate", {
        _location_id: loc[s.key],
        _tax_rate_ppm: s.taxRatePpm,
      });
      await rpc(owner, "update_location", {
        _id: loc[s.key],
        _name: s.name,
        _address: s.address,
        _phone: s.phone,
        _timezone: TIMEZONE,
        _hours: hoursOf(s),
      });
    }
  Object.assign(creds, { org: { id: orgId, slug: org.slug, name: ORG.name }, stores: loc });
  save();
  log(
    `organization ${org.slug} with stores ${STORES.map((s) => s.name).join(", ")} (${existing ? "kept" : "created"})`,
  );

  // 3. On a reset, the previous operational data goes first (organization, stores and members stay).
  //    It runs through the destination check of the dataset functions, so a refused destination
  //    stops here, before any account or invitation is created.
  if (existing) {
    const removed = await rpc(svc, "client_preview_purge_operational", { _org_id: orgId });
    log(
      `previous operational data removed (${removed.orders ?? 0} orders, ${removed.inventory_items ?? 0} stock items)`,
    );
  }

  // 4. Team through the real invitation flow: demo manager and kitchen accounts (store-scoped) and the
  //    personal owners (Owner, organization-wide). Existing members are kept as they are.
  const current = await members(svc, orgId);
  const isMember = (userId) => current.some((m) => m.user_id === userId);
  const profiles = await must(
    owner.from("permission_profiles").select("id,key").eq("is_system", true),
    "profiles",
  );
  const P = Object.fromEntries(profiles.map((p) => [p.key, p.id]));
  for (const a of ACCOUNTS.filter((x) => x.role !== "owner")) {
    if (isMember(creds.accounts[a.key].userId)) continue;
    const token = await rpc(owner, "create_invitation", {
      _org_id: orgId,
      _email: a.email,
      _role: a.role,
      _location_ids: a.stores.map((k) => loc[k]),
      _profile_id: a.profile ? P[a.profile] : null,
    });
    const member = await signIn(creds.accounts[a.key].email, creds.accounts[a.key].password);
    await rpc(member, "accept_invitation", { _token: token });
  }
  const personalState = [];
  for (const email of owners) {
    const label = personalLabel(owners, email);
    const found = audit.personal.find((u) => u.email.toLowerCase() === email);
    if (found) {
      const m = current.find((x) => x.user_id === found.id);
      if (m?.role !== "owner")
        throw new SeedError(
          `${label} has an account but is not an owner of the demo organization (run teardown)`,
        );
      personalState.push({ label, userId: found.id, state: "kept" });
      continue;
    }
    // New person: a confirmed account with a one-time password kept only in memory for the single
    // sign-in that accepts the invitation; the person then sets their own password (recovery link).
    const oneTime = newPassword();
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: oneTime,
      email_confirm: true,
      user_metadata: {
        preferred_language: "en-US",
        ...(target.personalOwnerNames?.[email]
          ? { full_name: target.personalOwnerNames[email] }
          : {}),
      },
    });
    if (error) throw new SeedError(`createUser ${label}: ${error.message}`);
    const token = await rpc(owner, "create_invitation", {
      _org_id: orgId,
      _email: email,
      _role: "owner",
      _location_ids: [],
      _profile_id: null,
    });
    let person;
    try {
      person = await signIn(email, oneTime);
    } catch {
      throw new SeedError(`sign-in of ${label} for the invitation failed`);
    }
    await rpc(person, "accept_invitation", { _token: token });
    await person.auth.signOut();
    personalState.push({
      label,
      userId: data.user.id,
      state: "created, invited as Owner, accepted",
    });
  }
  // Display names from the operator's secrets file: filled only where the profile has none, so a
  // name the person chose is never overwritten. Neither the name nor the address is logged.
  for (const [i, email] of owners.entries()) {
    const name = target.personalOwnerNames?.[email];
    if (!name) continue;
    const { data: named, error: nameError } = await svc
      .from("profiles")
      .update({ full_name: name })
      .eq("id", personalState[i].userId)
      .or("full_name.is.null,full_name.eq.")
      .select("id");
    if (nameError)
      throw new SeedError(`display name of ${personalState[i].label}: ${nameError.message}`);
    personalState[i].state += named.length
      ? ", display name set"
      : ", display name already present";
  }
  for (const p of personalState) log(`${p.label}: ${p.state}`);
  creds.personalOwners = personalState;
  save();

  // 5. Operational data.
  await seedOperational({ owner, svc, orgId, org, loc, plan, log, concurrency });

  let onboarding = "complete";
  try {
    await rpc(owner, "set_onboarding_step", { _org_id: orgId, _step: 5 });
  } catch (e) {
    onboarding = `not completed: ${e.message}`;
  }
  creds.seededAt = new Date().toISOString();
  creds.anchorNow = iso(now);
  creds.summary = {
    ...plan.summary,
    mode: existing ? "reset" : "seed",
    startYmd: plan.startYmd,
    todayYmd: plan.todayYmd,
    onboarding,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  save();
  log(
    `client-preview dataset ready on ${target.where} in ${creds.summary.seconds}s (credentials in the credentials file; passwords and personal addresses not printed)`,
  );
  return {
    orgId,
    slug: org.slug,
    stores: loc,
    summary: creds.summary,
    credsPath,
    personalOwners: personalState,
  };
}

/** Menu, stock, recipes, suppliers, expenses, purchases, sales history, alerts, open orders, times. */
async function seedOperational({ owner, svc, orgId, org, loc, plan, log, concurrency }) {
  // 3. Menu.
  for (const c of CATEGORIES)
    await rpc(owner, "save_operational_menu", {
      _org_id: orgId,
      _kind: "category",
      _payload: { op: "create", id: c.id, name: c.name },
    });
  for (const p of PRODUCTS)
    await rpc(owner, "save_operational_menu", {
      _org_id: orgId,
      _kind: "product",
      _payload: {
        id: p.id,
        orgId: org.slug,
        name: p.name,
        description: p.description,
        category: p.category,
        priceCents: p.priceCents,
        prepTimeMinutes: p.prep,
        imageUrl: "",
        notes: "",
        active: true,
        locationIds: STORES.filter((s) => !(p.notAt ?? []).includes(s.key)).map((s) => loc[s.key]),
        modifierGroups: p.modifiers,
        createdAt: iso(plan.openingsAt),
      },
    });

  // 4. Suppliers, stock (opening quantities), recipes, expenses.
  const supplierId = {};
  for (const s of SUPPLIERS)
    supplierId[s.key] = await rpc(owner, "save_operational_record", {
      _org_id: orgId,
      _location_id: NIL,
      _kind: "supplier",
      _payload: { name: s.name, notes: s.notes, active: true },
    });
  const itemId = {};
  for (const store of STORES) {
    const sp = plan.stockPlan[store.key];
    itemId[store.key] = {};
    for (const s of STOCK)
      itemId[store.key][s.sku] = await rpc(owner, "save_operational_record", {
        _org_id: orgId,
        _location_id: loc[store.key],
        _kind: "inventory",
        _payload: {
          name: s.name,
          category: s.category,
          sku: s.sku,
          unit: s.unit,
          quantity: sp.opening[s.sku],
          minQuantity: sp.minQuantity[s.sku],
          costCents: s.costCents,
          supplier: SUPPLIERS.find((x) => x.key === s.supplier).name,
          active: true,
        },
      });
    for (const p of PRODUCTS.filter((x) => !(x.notAt ?? []).includes(store.key)))
      await rpc(owner, "save_operational_record", {
        _org_id: orgId,
        _location_id: loc[store.key],
        _kind: "recipe",
        _payload: {
          productId: p.id,
          servings: 1,
          yieldQuantity: 1,
          // The app reads the price from the linked menu product; the copy in metadata follows it.
          sellingPriceCents: p.priceCents,
          ingredients: p.recipe.map(([sku, quantity, unit, waste]) => ({
            inventoryItemId: itemId[store.key][sku],
            quantity,
            unit,
            wastePercentage: waste,
          })),
        },
      });
  }
  for (const e of plan.expenses)
    await rpc(owner, "save_operational_record", {
      _org_id: orgId,
      _location_id: loc[e.store],
      _kind: "expense",
      _payload: e.payload,
    });
  log(
    `menu ${PRODUCTS.length} products, ${STOCK.length} stock items x ${STORES.length} stores, recipes, ${plan.expenses.length} expenses`,
  );

  // 5. Business history, in business-time order per store (stores run in parallel lanes).
  const backdate = { orders: [], receipts: [] };
  let done = 0;
  const lane = async (storeKey) => {
    const L = loc[storeKey];
    const store = STORES.find((s) => s.key === storeKey);
    for (const ev of plan.events.filter((x) => x.store === storeKey)) {
      if (ev.kind === "receipt") {
        const rc = ev.receipt;
        const poId = await rpc(owner, "save_operational_record", {
          _org_id: orgId,
          _location_id: L,
          _kind: "purchase",
          _payload: {
            supplierId: supplierId[rc.supplier],
            status: "sent",
            discountCents: 0,
            taxCents: 0,
            shippingCents: 0,
            notes: "Weekly order (demo)",
            items: rc.items.map((i) => ({
              inventoryItemId: itemId[storeKey][i.sku],
              quantityOrdered: i.quantity,
              unitPriceCents: i.unitPriceCents,
            })),
          },
        });
        const lines = await must(
          owner
            .from("purchase_order_items")
            .select("id,quantity_ordered")
            .eq("purchase_order_id", poId),
          "purchase lines",
        );
        const receiptId = await rpc(
          owner,
          "receive_operational_purchase",
          {
            _purchase_id: poId,
            _items: lines.map((l) => ({ itemId: l.id, receivedNow: Number(l.quantity_ordered) })),
            _client_event_id: `cp-receipt-${rc.key}`,
            _notes: "Received in full (demo)",
          },
          { idempotent: true },
        );
        backdate.receipts.push({
          id: receiptId,
          purchase_id: poId,
          ordered_at: iso(rc.orderedAt),
          received_at: iso(rc.receivedAt),
        });
        continue;
      }
      const s = ev.sale;
      const orderId = await rpc(
        owner,
        "persist_finalized_pos_sale_atomic_v2",
        {
          _org_id: orgId,
          _location_id: L,
          _type: s.type,
          _customer_name: s.customerName,
          _customer_phone: s.customerPhone,
          _customer_email: "",
          _delivery_address: s.deliveryAddress,
          _table_number: s.tableNumber,
          _notes: "",
          _discount_cents: s.discountCents,
          _tax_rate_ppm: store.taxRatePpm,
          _is_simulation: false,
          _client_order_id: s.clientOrderId,
          _items: s.items.map((i) => ({
            product_id: i.productId,
            quantity: i.quantity,
            notes: "",
            modifiers: i.modifiers.map((m) => ({ group_id: m.groupId, option_id: m.optionId })),
          })),
          _payment_method: s.payment,
        },
        { idempotent: true },
      );
      for (const st of s.steps)
        await rpc(
          owner,
          "update_order_status",
          {
            _order_id: orderId,
            _new_status: st.status,
            _reason:
              st.status === "cancelled" ? "Customer changed the order (demo)" : "Kitchen (demo)",
          },
          { idempotent: st.status !== "cancelled" },
        );
      backdate.orders.push({
        id: orderId,
        at: iso(s.at),
        steps: s.steps.map((st) => ({ status: st.status, at: iso(st.at) })),
      });
      if (++done % 500 === 0) log(`  ${done} orders recorded`);
    }
  };
  const keys = STORES.map((s) => s.key);
  for (let i = 0; i < keys.length; i += concurrency)
    await Promise.all(keys.slice(i, i + concurrency).map(lane));
  log(
    `${backdate.orders.length} orders and ${backdate.receipts.length} receipts recorded through the POS and purchasing RPCs`,
  );

  // Closing check: the planned alert items lose what spoiled (inventory "loss", as on the stock
  // screen), ending with 30 servings — below their minimum (alerts show) yet sellable in a live demo.
  for (const store of STORES)
    for (const sku of plan.stockPlan[store.key].lowAtEnd) {
      const it = await must(
        owner
          .from("inventory_items")
          .select("id,quantity,min_quantity")
          .eq("id", itemId[store.key][sku])
          .single(),
        "stock item",
      );
      const desired = plan.stockPlan[store.key].alertKeep[sku];
      const loss = Math.round((Number(it.quantity) - desired) * 100) / 100;
      if (loss > 0)
        await rpc(
          owner,
          "record_operational_movement",
          {
            _org_id: orgId,
            _location_id: loc[store.key],
            _item_id: it.id,
            _type: "loss",
            _quantity: loss,
            _reason: "Spoilage at the closing check (demo)",
            _client_event_id: `cp-loss-${store.key}-${sku}`,
          },
          { idempotent: true },
        );
    }

  // 6. One open purchase order per store (sent, waiting for delivery).
  for (const store of STORES) {
    const po = plan.stockPlan[store.key].openPo;
    await rpc(owner, "save_operational_record", {
      _org_id: orgId,
      _location_id: loc[store.key],
      _kind: "purchase",
      _payload: {
        supplierId: supplierId[po.supplier],
        status: "sent",
        discountCents: 0,
        taxCents: 0,
        shippingCents: 0,
        notes: "Next delivery (demo)",
        items: po.items.map((i) => ({
          inventoryItemId: itemId[store.key][i.sku],
          quantityOrdered: i.quantity,
          unitPriceCents: i.unitPriceCents,
        })),
      },
    });
  }

  // 7. Business times.
  const counts = { orders: 0, receipts: 0, openings: 0 };
  for (let i = 0; i < backdate.orders.length; i += 250) {
    const r = await rpc(svc, "client_preview_backdate", {
      _org_id: orgId,
      _plan: { orders: backdate.orders.slice(i, i + 250) },
    });
    counts.orders += r.orders;
  }
  const r2 = await rpc(svc, "client_preview_backdate", {
    _org_id: orgId,
    _plan: { receipts: backdate.receipts, openings_at: iso(plan.openingsAt) },
  });
  counts.receipts += r2.receipts;
  counts.openings += r2.openings;
  log(
    `history back-dated: ${counts.orders} orders, ${counts.receipts} receipts, ${counts.openings} opening movements`,
  );
}
