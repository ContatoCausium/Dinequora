import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAssistantSnapshot, type AssistantSnapshotRows } from "./assistant-snapshot";
import { readRecipeCosts } from "./operational.functions";

/**
 * Management assistant (migration 0040). A member with assistant.use (feature ai_assistant) asks a
 * question about the restaurant; the server reads a compact snapshot of the data THROUGH RLS, as that
 * member (so the model never sees more than the member can), sends it with the question to Claude, and
 * records the token usage. Nothing is sent when the server has no ANTHROPIC_API_KEY, when the
 * organization reached its monthly token cap, or when the member lacks the permission.
 *
 * The answer is advisory text: the assistant never acts (no sale, refund, price or stock change).
 */
export const ASSISTANT_MODEL = "claude-opus-5-5";
const DEFAULT_MONTHLY_TOKEN_CAP = 2_000_000;

const SYSTEM_PROMPT = `You are the management assistant of Dinequora, a restaurant operations platform used by restaurants in the United States.

You answer questions from a restaurant owner or manager about their own business, using ONLY the data snapshot included in their message (sales and costs from the ledger, best sellers, menu engineering per dish, stock below its minimum, open orders, stores). The snapshot was read with the asking person's permissions: if a part is empty or missing, say that this information is not available to them or not recorded yet. Never invent numbers, periods, products or causes.

How to answer:
- Answer in the language of the question (Portuguese or English).
- Lead with the direct answer, then the numbers that support it, with their period (for example "last 7 days") and the store when it matters.
- Money is in US dollars; the snapshot gives cents, so convert (12345 cents = $123.45).
- When you suggest something (a purchase, a price review, a promotion), say it is a suggestion and what in the data supports it.
- For questions about which dishes to promote, reprice or remove, use menuEngineeringLast30Days (its method field explains the classes). A dish listed under soldWithoutRecipeCost has no known cost: say so instead of guessing its margin.
- Keep it short: a few sentences or a short list. No tables unless asked.
- You cannot change anything in the system. If asked to act (sell, refund, change a price, adjust stock), explain where in Dinequora the person can do it.`;

const askInput = z.object({
  orgId: z.string().min(1),
  locationId: z.string().min(1),
  question: z.string().trim().min(3).max(1000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }))
    .max(8)
    .default([]),
});

export type AssistantResult =
  | { status: "ok"; answer: string; model: string }
  | { status: "not_configured" | "limit_reached" | "refused" | "busy" | "unavailable" };

async function orgScope(client: SupabaseClient<Database>, orgId: string, locationId: string) {
  const isUuid = z.string().uuid().safeParse(orgId).success;
  const { data: orgs, error } = await client
    .from("organizations")
    .select("id,slug,name")
    .eq(isUuid ? "id" : "slug", orgId);
  const org = orgs?.[0];
  if (error || !org) throw new Error("forbidden");
  const { data: stores, error: le } = await client
    .from("locations")
    .select("id,slug,name,timezone")
    .eq("org_id", org.id);
  if (le) throw new Error("forbidden");
  const store =
    locationId === "all"
      ? null
      : ((stores ?? []).find((l) => l.id === locationId || l.slug === locationId) ?? null);
  if (locationId !== "all" && !store) throw new Error("location_forbidden");
  return { org, stores: stores ?? [], store };
}

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(askInput)
  .handler(async ({ data, context }): Promise<AssistantResult> => {
    const c = context.supabase;
    const s = await orgScope(c, data.orgId, data.locationId);
    const perms = await c.rpc("my_permissions", { _org_id: s.org.id });
    if (perms.error || !(perms.data ?? []).includes("assistant.use"))
      throw new Error("permission_denied");

    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) return { status: "not_configured" };
    const cap = Number(process.env["ASSISTANT_MONTHLY_TOKEN_CAP"] ?? DEFAULT_MONTHLY_TOKEN_CAP);
    const used = await c.rpc("assistant_month_tokens", { _org_id: s.org.id });
    if (used.error) throw new Error("assistant_unavailable");
    if (Number(used.data ?? 0) >= cap) return { status: "limit_reached" };

    // The snapshot, read through RLS as the asking member.
    const storeIds = s.store ? [s.store.id] : s.stores.map((x) => x.id);
    const [ledger, lowStock, sold, open, recipeCosts] = await Promise.all([
      c.rpc("ledger_day_totals", { _org_id: s.org.id, _location_ids: storeIds, _days: 30 }),
      c
        .from("inventory_items")
        .select("name,unit,quantity,min_quantity,location_id")
        .eq("org_id", s.org.id)
        .in("location_id", storeIds)
        .eq("active", true)
        .limit(500),
      // Aggregated in the database (0042), under the member's RLS: no row cap to truncate a busy month.
      c.rpc("menu_item_sales", { _org_id: s.org.id, _location_ids: storeIds, _days: 30 }),
      c
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("org_id", s.org.id)
        .in("location_id", storeIds)
        .in("status", ["new", "confirmed", "in_prep", "ready"]),
      // Recipe costs need inventory.costs; without it menu engineering is "not available" (null).
      readRecipeCosts(c, s.org.id).catch(() => null),
    ]);
    const rows: AssistantSnapshotRows = {
      organization: s.org.name,
      stores: s.stores.filter((x) => storeIds.includes(x.id)),
      ledger: ledger.error ? null : (ledger.data ?? null),
      inventory: lowStock.error ? null : (lowStock.data ?? []),
      itemSales: sold.error
        ? null
        : (sold.data ?? []).map((r) => ({
            location_id: r.location_id,
            product_id: r.product_id,
            product_name: r.product_name,
            units: Number(r.units),
            sales_cents: Number(r.sales_cents),
          })),
      recipeCosts,
      openOrders: open.error ? null : (open.count ?? 0),
      now: new Date().toISOString(),
    };
    const snapshot = buildAssistantSnapshot(rows);

    const client = new Anthropic({ apiKey });
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...data.history.map((h) => ({ role: h.role, content: h.text })),
      {
        role: "user",
        content: `DATA SNAPSHOT (JSON):\n${JSON.stringify(snapshot)}\n\nQUESTION:\n${data.question}`,
      },
    ];
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model: ASSISTANT_MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages,
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return { status: "not_configured" };
      if (e instanceof Anthropic.RateLimitError) return { status: "busy" };
      if (e instanceof Anthropic.APIError) return { status: "unavailable" };
      throw e;
    }
    const u = response.usage;
    await c.rpc("record_assistant_usage", {
      _org_id: s.org.id,
      ...(s.store ? { _location_id: s.store.id } : {}),
      _model: response.model,
      _input_tokens:
        (u.input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0),
      _output_tokens: u.output_tokens ?? 0,
      _question_chars: data.question.length,
    });
    if (response.stop_reason === "refusal") return { status: "refused" };
    const answer = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    if (!answer) return { status: "unavailable" };
    return { status: "ok", answer, model: response.model };
  });
