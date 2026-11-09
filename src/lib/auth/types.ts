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
}
