/**
 * Provider-independent authentication contract.
 * UI and routes depend only on this interface; swap the adapter in ./index.ts to change backend.
 */
export type SocialProvider = "google" | "microsoft";

export type AuthUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  fullName: string | null;
};

export type AuthErrorCode =
  | "invalid_credentials"
  | "invalid_code"
  | "mfa_required"
  | "email_not_verified"
  | "email_taken"
  | "invalid_email"
  | "weak_password"
  | "rate_limited"
  | "provider_unavailable"
  | "network"
  | "forbidden"
  | "backend"
  | "unknown";

export class AuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type AuthEvent = "signed_in" | "signed_out" | "user_updated" | "password_recovery";

/** An authenticator app (TOTP) linked to the account. */
export type MfaFactor = { id: string; name: string | null; verified: boolean; createdAt: string };
/** A new authenticator being linked: the QR code (an SVG data URL) and the secret to type by hand. */
export type MfaEnrollment = { factorId: string; qrCode: string; secret: string };
/** aal1 = password only; aal2 = password + authenticator code. */
export type MfaAssurance = { current: "aal1" | "aal2"; next: "aal1" | "aal2" };

/** Two-factor authentication with an authenticator app (TOTP). */
export interface MfaService {
  /** What this session has proven and what the account requires (next = aal2 once a factor is verified). */
  assurance(): Promise<MfaAssurance>;
  listFactors(): Promise<MfaFactor[]>;
  /** Starts linking an authenticator app; finish with confirmEnrollment. */
  enroll(name: string): Promise<MfaEnrollment>;
  /** Confirms a new authenticator with its first code; the session becomes aal2. */
  confirmEnrollment(factorId: string, code: string): Promise<void>;
  /** Proves the second factor for this session (after the password). */
  verify(code: string): Promise<void>;
  /** Removes an authenticator (needs an aal2 session). */
  remove(factorId: string): Promise<void>;
}

export interface AuthService {
  getUser(): Promise<AuthUser | null>;
  onChange(cb: (event: AuthEvent) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  /** Returns true when the user must confirm the email before signing in. */
  signUp(input: {
    email: string;
    password: string;
    fullName: string;
    language: string;
    redirectPath?: string;
  }): Promise<{ needsVerification: boolean }>;
  signInWithProvider(provider: SocialProvider): Promise<void>;
  resendVerification(email: string): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
  mfa: MfaService;
}
