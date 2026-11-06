import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";

import { AppShell } from "@/components/app/app-shell";
import { WorkspaceProvider } from "@/components/app/workspace-context";
import { fetchMemberships } from "@/lib/org-service";
import { isPlatformAdmin } from "@/lib/admin-service";
import { AppPending, AppError } from "@/components/app/states";

export const Route = createFileRoute("/_authenticated/_app")({
  loader: async ({ context }) => {
    const [memberships, admin] = await Promise.all([
      fetchMemberships(context.user.id),
      isPlatformAdmin(),
    ]);
    // No membership = no organization data. New users create their own or accept an invitation.
    // Platform admins without restaurant membership go to the Control Center, never into a tenant.
    if (memberships.length === 0) throw redirect({ to: admin ? "/control" : "/onboarding" });
    return { memberships, admin };
  },
  component: AppLayout,
  pendingComponent: AppPending,
  errorComponent: AppError,
});

function AppLayout() {
  const { memberships, admin } = Route.useLoaderData();
  const { user } = Route.useRouteContext();
  const router = useRouter();
  return (
    <WorkspaceProvider
      user={user}
      memberships={memberships}
      isPlatformAdmin={admin}
      onRefresh={() => void router.invalidate()}
    >
      <AppShell>
        <Outlet />
      </AppShell>
    </WorkspaceProvider>
  );
}
