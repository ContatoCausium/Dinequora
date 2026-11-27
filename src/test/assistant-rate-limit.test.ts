import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { overPerMinuteLimit } from "@/lib/assistant.functions";

/** A minimal stand-in for the query chain: from().select().eq().eq().gte() -> { count, error }. */
function fakeClient(result: { count: number | null; error: unknown }) {
  const calls: unknown[][] = [];
  const chain = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), chain),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), chain),
    gte: (...a: unknown[]) => (calls.push(["gte", ...a]), Promise.resolve(result)),
  };
  const client = { from: vi.fn((t: string) => (calls.push(["from", t]), chain)) };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

describe("assistant per-minute limit", () => {
  const NOW = Date.parse("2026-11-27T15:00:00Z");

  it("counts the member's own questions of the last minute in assistant_usage", async () => {
    const { client, calls } = fakeClient({ count: 2, error: null });
    expect(await overPerMinuteLimit(client, "org-1", "user-1", 6, NOW)).toBe(false);
    expect(calls).toEqual([
      ["from", "assistant_usage"],
      ["select", "id", { count: "exact", head: true }],
      ["eq", "org_id", "org-1"],
      ["eq", "user_id", "user-1"],
      ["gte", "created_at", "2026-11-27T14:59:00.000Z"],
    ]);
  });

  it("refuses at the limit", async () => {
    expect(
      await overPerMinuteLimit(fakeClient({ count: 6, error: null }).client, "o", "u", 6, NOW),
    ).toBe(true);
  });

  it("a limit of 0 turns it off; a failed read is an error, never a pass", async () => {
    expect(
      await overPerMinuteLimit(fakeClient({ count: 99, error: null }).client, "o", "u", 0, NOW),
    ).toBe(false);
    await expect(
      overPerMinuteLimit(fakeClient({ count: null, error: { message: "x" } }).client, "o", "u", 6),
    ).rejects.toThrow("assistant_unavailable");
  });
});
