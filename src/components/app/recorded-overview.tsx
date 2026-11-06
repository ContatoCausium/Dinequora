import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspace } from "./workspace-context";
import { fetchOperationalResources, fetchOperationalOrders } from "@/lib/operational.functions";
import { ledgerMetrics } from "@/lib/operational-metrics";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { PageHeader } from "./page";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function RecordedOverview() {
  const { org, locationId } = useWorkspace();
  const { t, i18n } = useTranslation("operations");
  const [state, setState] = useState<{ revenue: number; cogs: number; orders: number } | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    setState(null);
    setError(false);
    Promise.all([
      fetchOperationalResources({ data: { orgId: org.id, locationId } }),
      fetchOperationalOrders({ data: { orgId: org.id, locationId } }),
    ])
      .then(([r, o]) => {
        if (!active) return;
        const m = ledgerMetrics(r.finance);
        setState({ revenue: m.revenueCents, cogs: m.cogsCents, orders: o.totalCount });
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [org.id, locationId, tick]);
  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        eyebrow={org.name}
        title={t("recorded")}
        actions={
          <Button
            variant="outline"
            size="icon"
            title={t("refresh")}
            onClick={() => setTick((v) => v + 1)}
          >
            <RefreshCw className="size-4" />
          </Button>
        }
      />
      {error ? (
        <p className="text-destructive">{t("failed")}</p>
      ) : !state ? (
        <p className="text-muted-foreground">{t("loading")}</p>
      ) : (
        <>
          <dl className="grid gap-6 border-y py-6 sm:grid-cols-3">
            {[
              { name: t("netRevenue"), value: fmtCurrency(state.revenue, i18n.language) },
              { name: t("cogs"), value: fmtCurrency(state.cogs, i18n.language) },
              { name: t("orders"), value: fmtNumber(state.orders, i18n.language) },
            ].map((x) => (
              <div key={x.name}>
                <dt className="text-sm text-muted-foreground">{x.name}</dt>
                <dd className="mt-2 text-2xl font-semibold">{x.value}</dd>
              </div>
            ))}
          </dl>
          {state.orders === 0 && <p className="text-muted-foreground">{t("empty")}</p>}
        </>
      )}
    </div>
  );
}
