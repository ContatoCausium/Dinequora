import { useCallback, useEffect, useState } from "react";
import {
  listOrgInsights,
  listPlans,
  listPlatformAudit,
  type OrgInsight,
  type PlanDef,
  type PlatformAudit,
} from "@/lib/admin-service";

import { requestErrorKind, type RequestErrorKind } from "@/lib/request-error";

type Data = { orgs: OrgInsight[]; plans: PlanDef[]; audit: PlatformAudit[] };

/** Loads Control Center data; every call is re-authorized by the database. */
export function useControlData(auditLimit = 200) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<RequestErrorKind | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [orgs, plans, audit] = await Promise.all([
        listOrgInsights(),
        listPlans(),
        listPlatformAudit(auditLimit),
      ]);
      setData({ orgs, plans, audit });
    } catch (e) {
      setData(null);
      setError(requestErrorKind(e));
    } finally {
      setLoading(false);
    }
  }, [auditLimit]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}
