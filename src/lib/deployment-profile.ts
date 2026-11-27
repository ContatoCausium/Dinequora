/**
 * Deployment profile, fixed at build time by `VITE_DEPLOYMENT_PROFILE` (inlined by Vite into both the
 * browser and the SSR bundle, so it cannot be switched at runtime or from the browser).
 *
 * - `standard` (unset, empty or "standard"): the normal product.
 * - `client-preview`: the commercial preview built by `scripts/preview/build-client-preview.mjs`
 *   (public sign-up hidden, presentation mode unavailable, security and no-index headers on).
 *
 * Fails closed: any other non-empty value is treated as `client-preview`, so a typo can only make a
 * build more restrictive, never expose sign-up on the preview.
 */
export type DeploymentProfile = "standard" | "client-preview";

export function parseDeploymentProfile(raw: string | undefined): DeploymentProfile {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "" || value === "standard") return "standard";
  return "client-preview";
}

export function deploymentProfile(): DeploymentProfile {
  return parseDeploymentProfile(import.meta.env["VITE_DEPLOYMENT_PROFILE"] as string | undefined);
}

export function isClientPreview(): boolean {
  return deploymentProfile() === "client-preview";
}
