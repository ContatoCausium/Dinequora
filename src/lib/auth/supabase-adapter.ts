import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { AuthError, type AuthErrorCode, type AuthService, type AuthUser } from "./types";
import { requestErrorKind } from "@/lib/request-error";

function mapError(
  e:
    | { message?: string | undefined; code?: string | undefined; status?: number | undefined }
    | null
    | undefined,
): AuthError {
  const msg = (e?.message ?? "").toLowerCase();
  const code = e?.code ?? "";
  let c: AuthErrorCode = requestErrorKind(e);
  if (code === "invalid_credentials" || msg.includes("invalid login")) c = "invalid_credentials";
  else if (code === "email_not_confirmed" || msg.includes("not confirmed"))
    c = "email_not_verified";
  else if (code === "user_already_exists" || msg.includes("already registered")) c = "email_taken";
  else if (
    msg.includes("email address") &&
    (msg.includes("not allowed") || msg.includes("invalid"))
  )
    c = "invalid_email";
  else if (code.startsWith("weak_password") || msg.includes("password")) c = "weak_password";
  else if (e?.status === 429 || msg.includes("rate limit")) c = "rate_limited";
  else if (msg.includes("provider")) c = "provider_unavailable";
  return new AuthError(c, e?.message);
}

const origin = () => window.location.origin;

export const supabaseAuth: AuthService = {
  async getUser() {
    const { data } = await supabase.auth.getUser();
    const u = data.user;
    if (!u) return null;
    const user: AuthUser = {
      id: u.id,
      email: u.email ?? "",
      emailVerified: Boolean(u.email_confirmed_at),
      fullName:
        (u.user_metadata?.["full_name"] as string) ?? (u.user_metadata?.["name"] as string) ?? null,
    };
    return user;
  },
  onChange(cb) {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") cb("signed_in");
      else if (event === "SIGNED_OUT") cb("signed_out");
      else if (event === "USER_UPDATED") cb("user_updated");
      else if (event === "PASSWORD_RECOVERY") cb("password_recovery");
    });
    return () => data.subscription.unsubscribe();
  },
  async signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw mapError(error);
  },
  async signUp({ email, password, fullName, language, redirectPath }) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: origin() + (redirectPath ?? "/auth"),
        data: { full_name: fullName, preferred_language: language },
      },
    });
    if (error) throw mapError(error);
    // An existing address returns a user with no identities and no session.
    if (data.user && data.user.identities?.length === 0) throw new AuthError("email_taken");
    return { needsVerification: !data.session };
  },
  async signInWithProvider(provider) {
    const result = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: origin() + "/auth",
    });
    if (result.error) throw mapError(result.error as { message?: string });
  },
  async resendVerification(email) {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: origin() + "/auth" },
    });
    if (error) throw mapError(error);
  },
  async sendPasswordReset(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: origin() + "/reset-password?recovery=1",
    });
    if (error) throw mapError(error);
  },
  async updatePassword(password) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw mapError(error);
  },
  async signOut() {
    await supabase.auth.signOut();
  },
};
