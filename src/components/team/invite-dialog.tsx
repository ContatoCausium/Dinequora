import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, Link2, Loader2 } from "lucide-react";

import { useWorkspace } from "@/components/app/workspace-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { invitableRoles } from "@/lib/access-rules";
import { createInvitation } from "@/lib/org-service";
import { cn } from "@/lib/utils";
import { useProfileText, useTeamError } from "./team-hooks";
import { StoreChecklist } from "./team-ui";
import type { OrgRole, PermissionProfile } from "./team-types";

const DEFAULT = "__tier_default";
const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

export function InviteDialog({
  open,
  onOpenChange,
  profiles,
  scope,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  profiles: PermissionProfile[];
  /** Store DB ids the inviter may hand out (owner: all org stores; manager: their stores). */
  scope: string[];
  onCreated: (email: string, url: string) => void;
}) {
  const { t } = useTranslation("team");
  const { role: myRole, orgDbId } = useWorkspace();
  const err = useTeamError();
  const profileText = useProfileText();
  const roles = invitableRoles(myRole);
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<OrgRole>("staff");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [stores, setStores] = useState<string[]>([]);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);

  const reset = () => {
    setEmail("");
    setTier("staff");
    setProfileId(null);
    setStores([]);
    setEmailError(null);
    setServerError(null);
    setLink(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = email.trim();
    if (!isEmail(clean)) return setEmailError(t("invite.emailInvalid"));
    setEmailError(null);
    setServerError(null);
    setPending(true);
    try {
      const url = await createInvitation(
        orgDbId,
        clean,
        tier,
        tier === "owner" ? [] : stores,
        tier === "owner" ? null : profileId,
      );
      setLink({ url, email: clean });
      onCreated(clean, url);
    } catch (er) {
      setServerError(err.message(er));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{link ? t("invite.linkTitle") : t("invite.title")}</DialogTitle>
          <DialogDescription>
            {link ? t("invite.linkBody", { email: link.email }) : t("invite.subtitle")}
          </DialogDescription>
        </DialogHeader>

        {link ? (
          <div className="flex flex-col gap-3">
            <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Link2 className="mt-0.5 size-3.5 shrink-0" />
              {t("invite.notEmailed")}
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={link.url}
                aria-label={t("invite.linkTitle")}
                className="h-10 min-w-0 flex-1 font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                className="h-10"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link.url);
                    toast.success(t("invite.copied"));
                  } catch {
                    toast.error(t("invite.copyFailed"));
                  }
                }}
              >
                <Copy className="size-3.5" />
                {t("invite.copy")}
              </Button>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setLink(null)}>
                {t("invite.another")}
              </Button>
              <Button
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                {t("common.done")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="invite-email" className="text-sm font-medium">
                {t("invite.email")}
              </label>
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!emailError}
                aria-describedby={emailError ? "invite-email-error" : undefined}
                className="h-10"
              />
              {emailError && (
                <p id="invite-email-error" className="text-xs text-destructive">
                  {emailError}
                </p>
              )}
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">{t("invite.role")}</legend>
              {roles.map((r) => (
                <label
                  key={r}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
                    tier === r ? "border-primary/50 bg-primary-soft/50" : "hover:bg-muted/60",
                  )}
                >
                  <input
                    type="radio"
                    name="invite-tier"
                    value={r}
                    checked={tier === r}
                    onChange={() => {
                      setTier(r);
                      setProfileId(null);
                    }}
                    className="mt-0.5 accent-[var(--primary)]"
                  />
                  <span>
                    <span className="block text-sm font-medium">{t(`auth:roles.${r}`)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`roleHelp.${r}`)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {tier !== "owner" && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="invite-profile" className="text-sm font-medium">
                  {t("detail.profile")}
                </label>
                <Select
                  value={profileId ?? DEFAULT}
                  onValueChange={(v) => setProfileId(v === DEFAULT ? null : v)}
                >
                  <SelectTrigger id="invite-profile" className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT}>{t("detail.tierDefault")}</SelectItem>
                    {profiles
                      .filter((p) => p.tier === tier)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {profileText.name(p)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {tier !== "owner" && (
              <StoreChecklist
                legend={t("invite.stores")}
                value={stores}
                onChange={setStores}
                allowed={scope}
              />
            )}

            {serverError && (
              <p role="alert" className="text-sm text-destructive">
                {serverError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending} aria-busy={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {t("invite.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
