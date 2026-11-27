// Individual password-recovery link for ONE personal owner of the client preview, so each person sets
// their own password (nobody else ever knows it). The link is a secret:
//   * it is written only to a new file outside the repository (mode 600), never to stdout/stderr or
//     any log, and an existing file is never overwritten;
//   * the e-mail OTP that the Auth admin API also returns is discarded;
//   * the link is generated only for an address in the declared personal owners, whose account is an
//     Owner of the demo organization and holds no platform role;
//   * it points only at the preview app's /reset-password (a local run for the local stack;
//     workers.dev or https://preview.dinequora.com for the hosted preview), and is single-use; it
//     expires per the project's Auth settings (default 1 hour).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertResolvedTarget } from "./client-preview-target.mjs";
import { personalLabel } from "./personal-owners.mjs";
import { ORG } from "./dataset.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOCAL_APP = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;
const HOSTED_APP = /^https:\/\/([a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev|preview\.dinequora\.com)$/;

export class AccessLinkError extends Error {
  constructor(message) {
    super(`access link refused: ${message}`);
    this.name = "AccessLinkError";
  }
}

export function assertAppUrl(mode, raw) {
  const url = String(raw ?? "").replace(/\/+$/, "");
  const ok = mode === "local" ? LOCAL_APP.test(url) : HOSTED_APP.test(url);
  if (!ok)
    throw new AccessLinkError(
      mode === "local"
        ? "PREVIEW_APP_URL must be a local run (http://127.0.0.1:<port>) for the local stack"
        : "PREVIEW_APP_URL must be the preview Worker (*.workers.dev) or https://preview.dinequora.com",
    );
  return url;
}

export function assertLinkFile(file) {
  if (!file)
    throw new AccessLinkError("PREVIEW_LINK_FILE is required (a new file outside the repository)");
  const abs = path.resolve(file);
  const rel = path.relative(ROOT, abs);
  if (!rel.startsWith("..") && !path.isAbsolute(rel))
    throw new AccessLinkError("the link file must be outside the repository");
  if (fs.existsSync(abs))
    throw new AccessLinkError("the link file already exists (never overwritten)");
  return abs;
}

/**
 * Generates the link. `svc` is a server-key Supabase client of the checked target. Returns only
 * metadata (label, file); the link itself exists only in the file.
 */
export async function createAccessLink({
  target,
  svc,
  email,
  appUrl,
  linkFile,
  log = console.log,
}) {
  assertResolvedTarget(target);
  if (target.operation !== "access:client-preview")
    throw new AccessLinkError("the destination was not resolved for access:client-preview");
  const owners = target.personalOwners;
  const address = String(email ?? "")
    .trim()
    .toLowerCase();
  if (!owners.includes(address))
    throw new AccessLinkError("PREVIEW_ACCESS_EMAIL is not one of the declared personal owners");
  const label = personalLabel(owners, address);
  const app = assertAppUrl(target.mode, appUrl);
  const file = assertLinkFile(linkFile);

  // The person must already be an Owner of the demo organization, with no platform role.
  const { data: orgs, error: orgError } = await svc
    .from("organizations")
    .select("id")
    .eq("name", ORG.name)
    .eq("is_demo", true);
  if (orgError || orgs?.length !== 1)
    throw new AccessLinkError("the demo organization was not found");
  let user = null;
  for (let page = 1; page < 50 && !user; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new AccessLinkError("cannot list accounts");
    user = data.users.find((u) => (u.email ?? "").toLowerCase() === address) ?? null;
    if (data.users.length < 200) break;
  }
  if (!user) throw new AccessLinkError(`${label} has no account (run the seed first)`);
  const { data: membership } = await svc
    .from("organization_members")
    .select("role")
    .eq("org_id", orgs[0].id)
    .eq("user_id", user.id);
  if (membership?.length !== 1 || membership[0].role !== "owner")
    throw new AccessLinkError(`${label} is not an owner of the demo organization`);
  const { count: roles } = await svc
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (roles) throw new AccessLinkError(`${label} holds a platform role`);

  const { data, error } = await svc.auth.admin.generateLink({
    type: "recovery",
    email: address,
    options: { redirectTo: `${app}/reset-password` },
  });
  const link = data?.properties?.action_link;
  if (error || typeof link !== "string" || !link.startsWith("http"))
    throw new AccessLinkError(`the Auth service did not return a link for ${label}`);
  fs.writeFileSync(
    file,
    [
      `Dinequora Client Preview — personal access link (${label})`,
      "Single use. Expires per the project's Auth settings (default 1 hour).",
      "1. Open the preview and pass the Cloudflare Access code with your own e-mail.",
      "2. Then open this link in the same browser and choose your own password:",
      link,
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
  log(
    `recovery link for ${label} written to ${file} (single use). Send it privately to that person only, then delete the file.`,
  );
  return { label, file, userId: user.id };
}
