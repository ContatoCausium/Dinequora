/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Deployment profile (src/lib/deployment-profile.ts); inlined at build time. */
  readonly VITE_DEPLOYMENT_PROFILE?: string;
}
