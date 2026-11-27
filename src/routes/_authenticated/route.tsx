import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { auth, sessionPersistence } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    if (sessionPersistence.expired()) await auth.signOut();
    const user = await auth.getUser();
    if (!user) throw redirect({ to: "/auth", search: { redirect: location.href } });
    // An account with an authenticator app must prove it on this session before entering (aal2).
    // A failure to read the level never locks anyone out: the backend still enforces what it enforces.
    const aal = await auth.mfa.assurance().catch(() => null);
    if (aal && aal.next === "aal2" && aal.current !== "aal2")
      throw redirect({ to: "/mfa", search: { redirect: location.href } });
    return { user };
  },
  component: () => <Outlet />,
});
