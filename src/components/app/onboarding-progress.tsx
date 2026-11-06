import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Circle, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "./workspace-context";
import { fetchTeam, setOnboardingStep } from "@/lib/org-service";
import { canAdvance, onboardingChecklist, OPTIONAL_STEPS } from "@/lib/onboarding-checklist";
import { cn } from "@/lib/utils";

const destinations = ["/settings/branding", "/", "/locations", "/team", "/"] as const;

export function OnboardingProgress() {
  const { t } = useTranslation("team");
  const { org, orgDbId, role, refresh } = useWorkspace();
  const [saving, setSaving] = useState(false);
  const step = org.onboardingStep ?? 5;
  const active = role === "owner" && step < 5;
  const team = useQuery({
    queryKey: ["team", orgDbId],
    queryFn: () => fetchTeam(orgDbId),
    enabled: active,
  });
  if (!active) return null;

  const states = onboardingChecklist({
    logoUrl: org.logoUrl,
    brandEdited: org.previousBrand != null,
    locations: org.locations,
    memberCount: team.data?.members.length ?? 1,
    pendingInvites: team.data?.invites.length ?? 0,
    persistedStep: step,
  });
  const optional = (OPTIONAL_STEPS as readonly number[]).includes(step);
  const allowed = canAdvance(states, step);

  const next = async () => {
    if (!allowed) return;
    setSaving(true);
    try {
      await setOnboardingStep(orgDbId, step + 1);
      refresh();
    } catch {
      toast.error(t("onboarding.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-6 border-b pb-5" aria-label={t("onboarding.progressTitle")}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{t("onboarding.persistedTest")}</span>
        <span>·</span>
        <span>{t("onboarding.progress", { current: step + 1, total: 5 })}</span>
      </div>
      <ol className="mt-3 flex flex-wrap gap-2">
        {states.map((s, i) => (
          <li
            key={i}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
              i === step && "border-primary",
            )}
          >
            {s === "done" ? (
              <Check className="size-3.5 text-primary" />
            ) : s === "skipped" ? (
              <SkipForward className="size-3.5 text-muted-foreground" />
            ) : (
              <Circle className="size-3.5 text-muted-foreground" />
            )}
            <span>{t(`onboarding.stages.${i}.title`)}</span>
            <span className="text-muted-foreground">
              · {t(`onboarding.state.${s}`)}
              {(OPTIONAL_STEPS as readonly number[]).includes(i)
                ? ` · ${t("onboarding.optional")}`
                : ""}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">{t(`onboarding.stages.${step}.title`)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(`onboarding.stages.${step}.body`)}
          </p>
          {!allowed && (
            <p role="status" className="mt-1 text-sm text-destructive">
              {t(`onboarding.blocked.${step}`)}
            </p>
          )}
          {team.isError && (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {t("onboarding.teamLoadFailed")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to={destinations[step] ?? "/"}>
              {t("onboarding.openStep")}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button disabled={saving || !allowed} onClick={() => void next()}>
            {optional && states[step] !== "done" ? (
              <SkipForward className="size-4" />
            ) : (
              <Check className="size-4" />
            )}
            {t(
              step === 4
                ? "onboarding.finish"
                : optional && states[step] !== "done"
                  ? "onboarding.skip"
                  : "onboarding.continue",
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}
