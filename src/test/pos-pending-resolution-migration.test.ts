// 0032: the sale path changes by exactly ONE line, under the sale's own lock (file-level review aid;
// the database behaviour is covered by the integration test and the two-session race script).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (name: string) =>
  fs
    .readFileSync(path.resolve(__dirname, "../../drizzle/migrations", name), "utf8")
    .replace(/\r\n/g, "\n");
const saleFunction = (src: string) => {
  const start = src.indexOf("CREATE OR REPLACE FUNCTION public.create_pos_sale_v2(");
  return src.slice(start, src.indexOf("$function$;", start) + "$function$;".length);
};
const M0025 = read("0025_store_sales_tax_rate.sql");
const M0032 = read("0032_pos_pending_sale_resolution.sql");
const LOCK =
  "pg_advisory_xact_lock(hashtextextended(_org_id::text||':'||trim(_client_order_id),0))";

describe("create_pos_sale_v2 in 0032", () => {
  it("is the 0025 body plus exactly one line: the closed-key check", () => {
    const before = saleFunction(M0025).split("\n");
    const after = saleFunction(M0032).split("\n");
    expect(after).toHaveLength(before.length + 1);
    const added = after.filter((l) => !before.includes(l));
    expect(added).toEqual([
      "IF EXISTS(SELECT 1 FROM public.pos_sale_key_voids v WHERE v.org_id=_org_id AND v.client_order_id=trim(_client_order_id)) THEN RAISE EXCEPTION 'sale_key_voided'; END IF;",
    ]);
    expect(after.filter((l) => l !== added[0])).toEqual(before);
  });

  it("checks the closed key AFTER the lock and AFTER the existing-order check", () => {
    const body = saleFunction(M0032);
    const lock = body.indexOf(LOCK);
    const existing = body.indexOf("IF existing.id IS NOT NULL THEN");
    const voided = body.indexOf("'sale_key_voided'");
    expect(lock).toBeGreaterThan(0);
    expect(existing).toBeGreaterThan(lock);
    expect(voided).toBeGreaterThan(existing);
  });

  it("the resolution takes exactly the same lock", () => {
    const fn = M0032.slice(M0032.indexOf("function public.resolve_pending_pos_sale("));
    expect(fn).toContain("pg_advisory_xact_lock(hashtextextended(_org_id::text || ':' || k, 0))");
    // k is btrim(_client_order_id); the sale uses trim(_client_order_id): identical for text
    expect(fn).toContain("k text := btrim(coalesce(_client_order_id, ''))");
    // order lookup before any closure, closure only when no order exists
    const lookup = fn.indexOf("from public.orders where org_id = _org_id and client_order_id = k");
    const insert = fn.indexOf("insert into public.pos_sale_key_voids");
    expect(lookup).toBeGreaterThan(fn.indexOf("pg_advisory_xact_lock"));
    expect(insert).toBeGreaterThan(lookup);
  });
});
