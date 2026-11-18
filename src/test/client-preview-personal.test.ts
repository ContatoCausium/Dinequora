import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  isReservedTestEmail,
  parsePersonalOwnerNames,
  parsePersonalOwners,
  personalLabel,
  PersonalOwnersError,
} from "../../scripts/preview/personal-owners.mjs";
import {
  assertClientPreviewApi,
  assertPreviewIdentity,
  PreviewRefusal,
} from "../../scripts/preview/preview-target.mjs";
import { resolvePreviewTarget } from "../../scripts/preview/client-preview-target.mjs";
import {
  AccessLinkError,
  assertAppUrl,
  assertLinkFile,
  createAccessLink,
} from "../../scripts/preview/personal-access.mjs";

/**
 * Client preview, personal owners: at most two real people, declared outside the repository
 * (PREVIEW_PERSONAL_OWNERS), fixed in the hosted marker, Owners of the demo organization only, each
 * with an individual account and an individual recovery link that never reaches a log. Addresses
 * here are fictional (example.com is reserved, but its .com TLD makes it count as a "real" address,
 * as a person's mailbox would). Nothing reaches a network or a database.
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const A = "first.owner@example.com";
const B = "second.owner@example.com";
const C = "third.person@example.com";
// Stand-ins for a LOCAL stack, which never holds real people.
const LA = "first.owner@personal.test";
const LB = "second.owner@personal.test";
const LC = "third.person@personal.test";
const REF = "abcdefghij0123456789";
const URL_ = `https://${REF}.supabase.co`;
const SECRET = "sb_secret_0123456789abcdefghijklmnop";
const IDENTITY = {
  label: "client-preview",
  project_ref: REF,
  marker_version: 2,
  marked_at: "2026-11-14T00:00:00Z",
  non_demo_organizations: 0,
  non_test_users: 0,
  personal_accounts: [A, B],
  platform_roles: 0,
};
const okFetch = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));
const temps: string[] = [];
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dq-cp-personal-"));
  temps.push(d);
  return d;
};
afterEach(() => {
  vi.unstubAllGlobals();
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("declared personal owners (PREVIEW_PERSONAL_OWNERS)", () => {
  it("accepts up to two real addresses, normalized and sorted", () => {
    expect(parsePersonalOwners(` ${B.toUpperCase()} , ${A} `)).toEqual([A, B]);
    expect(parsePersonalOwners(A)).toEqual([A]);
    expect(parsePersonalOwners("")).toEqual([]);
    expect(parsePersonalOwners(undefined)).toEqual([]);
  });
  it.each([
    ["three people", `${A},${B},${C}`, /at most 2/],
    ["a duplicate", `${A},${A.toUpperCase()}`, /duplicate/],
    ["not an address", "owner-without-at", /not an e-mail/],
    ["a .test address", "owner@personal.test", /reserved test/],
    ["the demo domain", "someone@client-preview.dinequora.test", /demo-account domain/],
    ["an .example address", "owner@shop.example", /reserved test/],
    ["an .invalid address", "owner@nowhere.invalid", /reserved test/],
    ["a .localhost address", "owner@box.localhost", /reserved test/],
  ])("refuses %s, without repeating the address", (_label, raw, message) => {
    let error: unknown;
    try {
      parsePersonalOwners(raw);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PersonalOwnersError);
    expect((error as Error).message).toMatch(message);
    for (const part of raw.split(",")) expect((error as Error).message).not.toContain(part.trim());
  });
  it("labels people without their address", () => {
    expect(personalLabel([A, B], B)).toBe("personal owner 2/2");
    expect(isReservedTestEmail("x@client-preview.dinequora.test")).toBe(true);
    expect(isReservedTestEmail(A)).toBe(false);
  });
});

describe("hosted guard: the list fixed in the marker", () => {
  it("accepts the marker when the declared owners are exactly the fixed ones", () => {
    expect(() => assertPreviewIdentity(IDENTITY, REF, [A, B])).not.toThrow();
    expect(() =>
      assertPreviewIdentity({ ...IDENTITY, personal_accounts: [] }, REF, []),
    ).not.toThrow();
  });
  it.each([
    ["a person declared instead of a fixed one", IDENTITY, [A, C]],
    ["one person missing from the declaration", IDENTITY, [A]],
    ["a declaration for an unmarked list", { ...IDENTITY, personal_accounts: [] }, [A]],
    ["a fixed list longer than two", { ...IDENTITY, personal_accounts: [A, B, C] }, [A, B]],
    ["a fixed list with a test address", { ...IDENTITY, personal_accounts: [A, "x@y.test"] }, [A]],
    ["a fixed list that is not a list", { ...IDENTITY, personal_accounts: "nope" }, []],
    ["no fixed list (old marker)", { ...IDENTITY, personal_accounts: undefined }, []],
    ["a real account outside the fixed list", { ...IDENTITY, non_test_users: 1 }, [A, B]],
    ["a platform admin", { ...IDENTITY, platform_roles: 1 }, [A, B]],
  ])("refuses %s", (_label, identity, declared) => {
    expect(() => assertPreviewIdentity(identity, REF, declared as string[])).toThrow(
      PreviewRefusal,
    );
  });
  it("the full API check carries the declaration and never prints an address", async () => {
    const fetchImpl = okFetch(IDENTITY);
    await expect(
      assertClientPreviewApi({
        apiUrl: URL_,
        serviceKey: SECRET,
        operation: "access:client-preview",
        confirm: `client-preview:access:client-preview:${REF}`,
        personalOwners: [A, B],
        fetchImpl,
      }),
    ).resolves.toMatchObject({ ref: REF });
    const e = await assertClientPreviewApi({
      apiUrl: URL_,
      serviceKey: SECRET,
      operation: "seed:client-preview",
      confirm: `client-preview:seed:client-preview:${REF}`,
      personalOwners: [A, C],
      fetchImpl: okFetch(IDENTITY),
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PreviewRefusal);
    for (const addr of [A, B, C]) expect((e as Error).message).not.toContain(addr);
  });
});

describe("destination resolver with personal owners", () => {
  const base = { PREVIEW_SERVICE_KEY: "svc", PREVIEW_PUBLISHABLE_KEY: "p".repeat(30) };
  it("refuses an invalid declaration before any request, in both modes", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const mode of ["local", "hosted"]) {
      const env = {
        ...base,
        PREVIEW_TARGET: mode,
        PREVIEW_API_URL: mode === "local" ? "http://127.0.0.1:64731" : URL_,
        PREVIEW_PERSONAL_OWNERS: `${A},${B},${C}`,
      };
      await expect(resolvePreviewTarget(env, "seed:client-preview")).rejects.toThrow(/at most 2/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("local mode refuses real addresses and hosted mode refuses stand-ins, before any request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      resolvePreviewTarget(
        {
          ...base,
          PREVIEW_TARGET: "local",
          PREVIEW_API_URL: "http://127.0.0.1:64731",
          PREVIEW_PERSONAL_OWNERS: A,
        },
        "seed:client-preview",
      ),
    ).rejects.toThrow(/real address/);
    await expect(
      resolvePreviewTarget(
        { ...base, PREVIEW_TARGET: "hosted", PREVIEW_API_URL: URL_, PREVIEW_PERSONAL_OWNERS: LA },
        "seed:client-preview",
      ),
    ).rejects.toThrow(/reserved test address/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("local mode carries the validated declaration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ cluster_hash: "0".repeat(64) }))),
    );
    const t = await resolvePreviewTarget(
      {
        ...base,
        PREVIEW_TARGET: "local",
        PREVIEW_API_URL: "http://127.0.0.1:64731",
        PREVIEW_PERSONAL_OWNERS: `${LB},${LA}`,
      },
      "access:client-preview",
    );
    expect(t.personalOwners).toEqual([LA, LB]);
  });
});

/** Minimal fake of the server-key client used by createAccessLink. */
function fakeSvc({
  users = [
    { id: "u-a", email: LA },
    { id: "u-b", email: LB },
  ],
  role = "owner",
  platformRoles = 0,
  link = "https://ref.supabase.co/auth/v1/verify?token=SECRET-TOKEN-123&type=recovery&redirect_to=x",
} = {}) {
  const generateLink = vi.fn(async () => ({
    data: { properties: { action_link: link, email_otp: "654321", hashed_token: "HASHED-TOKEN" } },
    error: null,
  }));
  const query = (table: string) => {
    const result =
      table === "organizations"
        ? { data: [{ id: "org-1" }], error: null }
        : table === "organization_members"
          ? { data: role ? [{ role }] : [], error: null }
          : { count: platformRoles, error: null };
    const chain: Record<string, unknown> = {};
    chain["select"] = () => chain;
    chain["eq"] = () => chain;
    chain["then"] = (resolve: (v: unknown) => unknown) => resolve(result);
    return chain;
  };
  return {
    generateLink,
    svc: {
      from: query,
      auth: { admin: { listUsers: async () => ({ data: { users }, error: null }), generateLink } },
    },
  };
}

async function accessTarget(owners = `${LA},${LB}`) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ cluster_hash: "0".repeat(64) }))),
  );
  return resolvePreviewTarget(
    {
      PREVIEW_TARGET: "local",
      PREVIEW_API_URL: "http://127.0.0.1:64731",
      PREVIEW_SERVICE_KEY: "svc",
      PREVIEW_PUBLISHABLE_KEY: "p".repeat(30),
      PREVIEW_PERSONAL_OWNERS: owners,
    },
    "access:client-preview",
  );
}

describe("individual recovery links", () => {
  it("writes ONE person's link to a new private file and logs neither the link, the token nor the address", async () => {
    const target = await accessTarget();
    const { svc, generateLink } = fakeSvc();
    const file = path.join(tmpDir(), "link-b.txt");
    const lines: string[] = [];
    const r = await createAccessLink({
      target,
      svc,
      email: LB.toUpperCase(),
      appUrl: "http://127.0.0.1:8798/",
      linkFile: file,
      log: (l) => lines.push(l),
    });
    expect(r).toMatchObject({ label: "personal owner 2/2", userId: "u-b" });
    expect(generateLink).toHaveBeenCalledTimes(1);
    expect(generateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: LB,
      options: { redirectTo: "http://127.0.0.1:8798/reset-password" },
    });
    const content = fs.readFileSync(file, "utf8");
    expect(content).toContain("SECRET-TOKEN-123");
    expect(content).not.toContain("654321"); // the e-mail OTP is discarded
    expect(content).not.toContain("HASHED-TOKEN");
    const logged = lines.join("\n");
    for (const secret of ["SECRET-TOKEN-123", "654321", "HASHED-TOKEN", LA, LB, "verify?token"])
      expect(logged).not.toContain(secret);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("each link is generated for its own person only", async () => {
    const target = await accessTarget();
    const { svc, generateLink } = fakeSvc();
    const dir = tmpDir();
    await createAccessLink({
      target,
      svc,
      email: LA,
      appUrl: "http://127.0.0.1:8798",
      linkFile: path.join(dir, "a.txt"),
      log: () => {},
    });
    await createAccessLink({
      target,
      svc,
      email: LB,
      appUrl: "http://127.0.0.1:8798",
      linkFile: path.join(dir, "b.txt"),
      log: () => {},
    });
    expect(
      generateLink.mock.calls.map((c) => (c as unknown as [{ email: string }])[0].email),
    ).toEqual([LA, LB]);
  });

  it.each([
    [
      "an address outside the declared owners",
      { email: LC },
      /not one of the declared personal owners/,
    ],
    [
      "a person without an account",
      { email: LA, users: [{ id: "u-b", email: LB }] },
      /has no account/,
    ],
    ["a person who is not an owner", { email: LA, role: "manager" }, /not an owner/],
    ["a person with a platform role", { email: LA, platformRoles: 1 }, /platform role/],
  ])("refuses %s, before generating anything", async (_label, over, message) => {
    const target = await accessTarget();
    const { svc, generateLink } = fakeSvc(over as Parameters<typeof fakeSvc>[0]);
    const file = path.join(tmpDir(), "x.txt");
    await expect(
      createAccessLink({
        target,
        svc,
        email: (over as { email: string }).email,
        appUrl: "http://127.0.0.1:8798",
        linkFile: file,
        log: () => {},
      }),
    ).rejects.toThrow(message);
    expect(generateLink).not.toHaveBeenCalled();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("points only at the preview app's reset page", () => {
    expect(assertAppUrl("local", "http://127.0.0.1:8798")).toBe("http://127.0.0.1:8798");
    expect(assertAppUrl("hosted", "https://dinequora-client-preview.demo.workers.dev")).toBe(
      "https://dinequora-client-preview.demo.workers.dev",
    );
    expect(assertAppUrl("hosted", "https://preview.dinequora.com/")).toBe(
      "https://preview.dinequora.com",
    );
    for (const [mode, bad] of [
      ["hosted", "http://127.0.0.1:8798"],
      ["hosted", "https://dinequora.com"],
      ["hosted", "https://evil.example/x.workers.dev"],
      ["local", "https://dinequora-client-preview.demo.workers.dev"],
      ["local", "http://10.0.0.5:8095"],
    ] as const)
      expect(() => assertAppUrl(mode, bad), `${mode} ${bad}`).toThrow(AccessLinkError);
  });

  it("the link file must be new and outside the repository", () => {
    expect(() => assertLinkFile(undefined)).toThrow(/required/);
    expect(() => assertLinkFile(path.join(ROOT, "link.txt"))).toThrow(/outside the repository/);
    const existing = path.join(tmpDir(), "exists.txt");
    fs.writeFileSync(existing, "x");
    expect(() => assertLinkFile(existing)).toThrow(/already exists/);
  });

  it("refuses a destination resolved for another operation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ cluster_hash: "0".repeat(64) }))),
    );
    const seedTarget = await resolvePreviewTarget(
      {
        PREVIEW_TARGET: "local",
        PREVIEW_API_URL: "http://127.0.0.1:64731",
        PREVIEW_SERVICE_KEY: "svc",
        PREVIEW_PUBLISHABLE_KEY: "p".repeat(30),
        PREVIEW_PERSONAL_OWNERS: LA,
      },
      "seed:client-preview",
    );
    const { svc } = fakeSvc();
    await expect(
      createAccessLink({
        target: seedTarget,
        svc,
        email: LA,
        appUrl: "http://127.0.0.1:8798",
        linkFile: path.join(tmpDir(), "s.txt"),
        log: () => {},
      }),
    ).rejects.toThrow(/access:client-preview/);
  });
});

describe("policy: personal data and secrets", () => {
  const previewFiles = () => {
    const tracked = execFileSync(
      "git",
      ["ls-files", "scripts/preview", "docs/operations/client-preview.md", "AGENTS.md"],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    )
      .split("\n")
      .filter(Boolean);
    const tests = fs
      .readdirSync(path.join(ROOT, "src/test"))
      .filter((f) => f.startsWith("client-preview-"))
      .map((f) => `src/test/${f}`);
    const untracked = fs
      .readdirSync(path.join(ROOT, "scripts/preview"))
      .filter((f) => /\.(mjs|mts)$/.test(f))
      .map((f) => `scripts/preview/${f}`);
    return [...new Set([...tracked, ...tests, ...untracked])].filter((f) =>
      fs.existsSync(path.join(ROOT, f)),
    );
  };

  it("no personal mailbox address in any client-preview file (they live only in the secrets file)", () => {
    const mailbox =
      /[a-z0-9._%+-]+@(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|proton|protonmail|aol|gmx|uol|bol|terra|ig)\.(com|com\.br|net|me)\b/i;
    for (const f of previewFiles()) expect(read(f), f).not.toMatch(mailbox);
  });

  it("the seed never stores or prints a personal owner's password or address", () => {
    const code = read("scripts/preview/seed-core.mjs");
    const uses = code.match(/\boneTime\b/g) ?? [];
    expect(uses.length).toBe(3); // declared, passed to createUser, used for the one sign-in
    expect(code).toMatch(/password: oneTime,/);
    expect(code).toMatch(/signIn\(email, oneTime\)/);
    expect(code).not.toMatch(/log\([^)]*\$\{email\}/);
    expect(code).not.toMatch(/log\([^)]*oneTime/);
    expect(code).toMatch(/personalLabel\(owners, email\)/);
  });

  it("personal owners join only through Owner invitations, never a platform role or a direct insert", () => {
    const code = read("scripts/preview/seed-core.mjs");
    expect(code).toMatch(/create_invitation[\s\S]{0,200}_role: "owner"/);
    expect(code).toMatch(/accept_invitation/);
    expect(code).not.toMatch(/from\("organization_members"\)\.(insert|upsert|update)/);
    expect(code).not.toMatch(
      /user_roles"\)\.(insert|upsert|update)|bootstrap_first_platform_admin|admin_grant/,
    );
  });

  it("the reset keeps people and replaces operational data; teardown is explicit", () => {
    const cli = read("scripts/preview/reset-client-preview.mjs");
    expect(cli).toMatch(/process\.env\.PREVIEW_TEARDOWN === "1"/);
    expect(cli).toMatch(/resetClientPreview\(target/);
    const core = read("scripts/preview/seed-core.mjs");
    expect(core).toMatch(/client_preview_purge_operational/);
    // the full purge (organization) is only reachable from the teardown
    const teardown = core.slice(core.indexOf("export async function teardownClientPreview"));
    expect(core.indexOf('"client_preview_purge",')).toBeGreaterThan(
      core.indexOf("export async function teardownClientPreview"),
    );
    expect(teardown.indexOf('"client_preview_purge",')).toBeLessThan(
      teardown.indexOf("export function seedClientPreview"),
    );
  });

  it("the reset keeps the organization's settings: brand, logo, stores and subscription are written by the first seed only", () => {
    const core = read("scripts/preview/seed-core.mjs").replace(/^\s*\/\/.*$/gm, "");
    const run = core.slice(
      core.indexOf("async function run("),
      core.indexOf("async function seedOperational("),
    );
    // each settings write sits directly in the first-seed branch (`if (!existing)` or the `else` of
    // `if (existing)`), and nowhere else in the run
    expect(run).toMatch(/if \(!existing\)\s*await rpc\(owner, "save_org_brand"/);
    expect(run).toMatch(
      /\} else\s*await must\(\s*svc\s*\.from\("subscriptions"\)\s*\.update\(\{\s*plan_id: ORG\.plan/,
    );
    expect(run).toMatch(
      /\} else\s*for \(const s of STORES\) \{\s*await rpc\(owner, "set_location_tax_rate"[\s\S]{0,160}await rpc\(owner, "update_location"/,
    );
    for (const call of [
      /"save_org_brand"/g,
      /"set_location_tax_rate"/g,
      /"update_location"/g,
      /from\("subscriptions"\)\s*\.update/g,
    ])
      expect(run.match(call)?.length, String(call)).toBe(1);
  });

  it("a reset checks the stores and subscription before removing anything, and stops instead of overwriting", () => {
    const core = read("scripts/preview/seed-core.mjs");
    const purge = core.indexOf('"client_preview_purge_operational"');
    const storeCheck = core.indexOf(
      "the reset keeps the store as it is and stops before removing anything",
    );
    const subCheck = core.indexOf("the reset keeps it as it is and stops");
    expect(storeCheck).toBeGreaterThan(-1);
    expect(subCheck).toBeGreaterThan(-1);
    expect(storeCheck).toBeLessThan(purge);
    expect(subCheck).toBeLessThan(purge);
  });
});

describe("personal owner display names (PREVIEW_PERSONAL_OWNER_NAMES)", () => {
  const OWNERS = "first.owner@example.com, second.owner@example.com";
  it("pairs names with addresses in the declared order, whatever the sorting of addresses", () => {
    expect(parsePersonalOwnerNames("zed@example.com,amy@example.com", "Zed, Amy")).toEqual({
      "zed@example.com": "Zed",
      "amy@example.com": "Amy",
    });
    expect(parsePersonalOwnerNames(OWNERS, " Ana  Lúcia ,José")).toEqual({
      "first.owner@example.com": "Ana Lúcia",
      "second.owner@example.com": "José",
    });
  });
  it("is optional: no names means an empty map", () => {
    expect(parsePersonalOwnerNames(OWNERS, undefined)).toEqual({});
    expect(parsePersonalOwnerNames(OWNERS, " , ")).toEqual({});
  });
  it("refuses a count mismatch or a name that is not a plain name, without repeating it", () => {
    expect(() => parsePersonalOwnerNames(OWNERS, "Only")).toThrow(PersonalOwnersError);
    // [names, the invalid one]
    const cases: [string, string][] = [
      ["<b>x</b>,Ok", "<b>x</b>"],
      ["Ok,https://x.test", "https://x.test"],
      ["Ok," + "a".repeat(41), "a".repeat(41)],
    ];
    for (const [names, invalid] of cases) {
      let error: unknown;
      try {
        parsePersonalOwnerNames(OWNERS, names);
      } catch (e) {
        error = e;
      }
      expect(error, names).toBeInstanceOf(PersonalOwnersError);
      expect((error as Error).message).not.toContain(invalid);
    }
  });
  it("the seed fills only an empty profile name and never logs names or addresses", () => {
    const seed = fs.readFileSync(
      path.resolve(__dirname, "../../scripts/preview/seed-core.mjs"),
      "utf8",
    );
    expect(seed).toMatch(/\.or\("full_name\.is\.null,full_name\.eq\."\)/);
    expect(seed).not.toMatch(/log\([^)]*personalOwnerNames/);
    expect(seed).not.toMatch(/log\([^)]*\bname\b[^)]*\)/);
  });
});

describe("reset brings demo display names up to date, never touches personal owners' names", () => {
  const seed = fs.readFileSync(
    path.resolve(__dirname, "../../scripts/preview/seed-core.mjs"),
    "utf8",
  );
  it("kept demo accounts keep their password: checked by sign-in before any write, never set again", () => {
    const run = seed.slice(
      seed.indexOf("async function run("),
      seed.indexOf("async function seedOperational("),
    );
    // the passwords of the credentials file are verified before the file is first written
    const check = run.indexOf("await (await signIn(a.email, p.password)).auth.signOut()");
    const firstSave = run.indexOf("    save();");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(firstSave);
    expect(run).toMatch(/nothing was changed/);
    // a password is written to Auth only on explicit rotation, never for a kept account
    expect(run).toMatch(
      /if \(!kept\[a\.key\]\) \{[\s\S]{0,120}updateUserById\(found\.id, \{ password \}\)/,
    );
    expect(run.match(/updateUserById\(found\.id, \{ password/g)).toHaveLength(1);
    expect(run).toMatch(/process\.env\.PREVIEW_ROTATE_DEMO_PASSWORDS === "1"/);
    // the kept passwords are in the file from its first write (an interrupted run never loses them)
    expect(run).toMatch(
      /accounts: Object\.fromEntries\(\s*ACCOUNTS\.filter\(\(a\) => kept\[a\.key\]\)/,
    );
  });
  it("kept demo accounts (reserved .test domain) get the dataset name when it differs", () => {
    expect(seed).toMatch(/const byEmail = new Map\(audit\.demo\.map/);
    expect(seed).toMatch(
      /user_metadata: \{ \.\.\.\(found\.user_metadata \?\? \{\}\), full_name: a\.fullName \}/,
    );
    expect(seed).toMatch(/\.update\(\{ full_name: a\.fullName \}\)\s*\.eq\("id", found\.id\)/);
    expect(seed).toMatch(
      /const isDemoAccount = \(u\) => \(u\.email \?\? ""\)\.toLowerCase\(\)\.endsWith\(`@\$\{EMAIL_DOMAIN\}`\)/,
    );
  });
  it("a personal owner's name is only filled while empty", () => {
    const personal = seed.slice(seed.indexOf("for (const [i, email] of owners.entries())"));
    expect(personal).toMatch(/\.or\("full_name\.is\.null,full_name\.eq\."\)/);
    expect(seed.match(/\.update\(\{ full_name: /g)).toHaveLength(2);
  });
});
