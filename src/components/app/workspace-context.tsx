import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { setObservabilityScope } from "@/lib/observability";
import { generateTheme, themeToCssVars, type BrandColors } from "@/lib/theme-engine";
import type { Organization } from "@/lib/tenants";
import {
  saveOrganizationBrand,
  type Membership,
  type OrgRole,
  type OrgStatus,
} from "@/lib/org-service";
import type { AuthUser } from "@/lib/auth";
import { applyUserLanguage } from "@/lib/profile-service";
import { useQuery } from "@tanstack/react-query";
import { fetchMyPermissions } from "@/lib/org-service";
import { roleDefaults, type Permission } from "@/lib/permissions";

type Mode = "light" | "dark";
type StoredBrand = {
  current: BrandColors & { logoUrl?: string | undefined };
  previous?: BrandColors & { logoUrl?: string | undefined };
};

type Ctx = {
  user: AuthUser;
  role: OrgRole;
  orgStatus: OrgStatus;
  suspendedReason: string | null;
  isPlatformAdmin: boolean;
  orgDbId: string;
  memberId: string;
  storeLimit: number;
  refresh: () => void;
  org: Organization;
  orgs: Organization[];
  setOrgId: (id: string) => void;
  locationId: string; // "all" or a location id
  setLocationId: (id: string) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  brand: BrandColors & { logoUrl?: string | undefined };
  saveBrand: (b: BrandColors & { logoUrl?: string | undefined }) => Promise<void>;
  resetBrand: () => Promise<void>;
  restorePrevious: () => Promise<void>;
  hasPrevious: boolean;
  /**
   * Effective permissions from the backend (my_permissions). UI hints only — every action and read
   * is re-checked server-side (RPC asserts + RLS). Falls back to the tier defaults while loading.
   */
  permissions: ReadonlySet<string>;
  permissionsReady: boolean;
  can: (p: Permission) => boolean;
  canAny: (ps: readonly Permission[]) => boolean;
};

const WorkspaceContext = createContext<Ctx | null>(null);

export function WorkspaceProvider({
  children,
  user,
  memberships,
  isPlatformAdmin = false,
  onRefresh,
}: {
  children: ReactNode;
  user: AuthUser;
  memberships: Membership[];
  isPlatformAdmin?: boolean;
  onRefresh?: () => void;
}) {
  const ORGANIZATIONS = useMemo(() => memberships.map((m) => m.org), [memberships]);
  const [orgId, setOrgIdState] = useState(ORGANIZATIONS[0]?.id ?? "");
  const membership = memberships.find((m) => m.org.id === orgId) ?? memberships[0];
  const [locationId, setLocationId] = useState("all");
  const [mode, setModeState] = useState<Mode>("light");
  const [stored, setStored] = useState<Record<string, StoredBrand>>({});

  if (!membership) throw new Error("Workspace requires a membership");
  const org = membership.org;

  // Restore client preferences after hydration.
  useEffect(() => {
    void applyUserLanguage(user.id).catch(() => {});
    const savedOrg = localStorage.getItem("servora.org");
    if (savedOrg && ORGANIZATIONS.some((o) => o.id === savedOrg)) setOrgIdState(savedOrg);
    const savedMode = localStorage.getItem("servora.mode");
    if (savedMode === "dark" || savedMode === "light") setModeState(savedMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tenant/store scope attached to every log and captured error (ids and role only, no PII).
  useEffect(() => {
    setObservabilityScope({
      orgId: membership.dbId,
      locationId,
      userId: user.id,
      role: membership.role,
    });
  }, [membership.dbId, membership.role, locationId, user.id]);
  useEffect(() => () => setObservabilityScope({}), []);

  const brand = useMemo(() => ({ ...org.brand, logoUrl: org.logoUrl }), [org]);

  const permsQuery = useQuery({
    queryKey: ["my-permissions", membership.dbId, membership.memberId],
    queryFn: () => fetchMyPermissions(membership.dbId),
    staleTime: 60_000,
  });
  const permissions = useMemo<ReadonlySet<string>>(
    () => new Set(permsQuery.data ?? roleDefaults(membership.role)),
    [permsQuery.data, membership.role],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", mode === "dark");
    const vars = themeToCssVars(generateTheme(brand, mode));
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  }, [brand, mode]);

  const persist = useCallback((id: string, value: StoredBrand | null) => {
    setStored((s) => {
      const next = { ...s };
      if (value) {
        next[id] = value;
      } else {
        delete next[id];
      }
      return next;
    });
  }, []);

  const value: Ctx = {
    user,
    role: membership.role,
    orgStatus: membership.status,
    suspendedReason: membership.suspendedReason,
    isPlatformAdmin,
    orgDbId: membership.dbId,
    memberId: membership.memberId,
    storeLimit: membership.storeLimit,
    refresh: () => onRefresh?.(),
    org,
    orgs: ORGANIZATIONS,
    setOrgId: (id) => {
      setOrgIdState(id);
      setLocationId("all");
      localStorage.setItem("servora.org", id);
    },
    locationId,
    setLocationId,
    mode,
    setMode: (m) => {
      setModeState(m);
      localStorage.setItem("servora.mode", m);
    },
    brand,
    saveBrand: (b) =>
      saveOrganizationBrand(membership.dbId, b).then(() => {
        persist(org.id, { current: b, previous: brand });
        onRefresh?.();
      }),
    resetBrand: async () => {
      const b = { primary: "#b5502f", accent: "#e0a23a", logoUrl: undefined };
      await saveOrganizationBrand(membership.dbId, b);
      persist(org.id, { current: b, previous: brand });
      onRefresh?.();
    },
    restorePrevious: async () => {
      const prev = stored[org.id]?.previous ?? org.previousBrand;
      if (prev) {
        await saveOrganizationBrand(membership.dbId, prev);
        persist(org.id, { current: prev, previous: brand });
        onRefresh?.();
      }
    },
    hasPrevious: Boolean(stored[org.id]?.previous ?? org.previousBrand),
    permissions,
    permissionsReady: permsQuery.isSuccess,
    can: (p) => permissions.has(p),
    canAny: (ps) => ps.some((p) => permissions.has(p)),
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

export function useScopedLocations() {
  const { org, locationId } = useWorkspace();
  return locationId === "all" ? org.locations : org.locations.filter((l) => l.id === locationId);
}
