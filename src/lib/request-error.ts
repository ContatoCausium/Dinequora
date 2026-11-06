export type RequestErrorKind = "network" | "forbidden" | "backend";
export function requestErrorKind(error: unknown): RequestErrorKind {
  const e = error as { message?: string; code?: string; status?: number } | null;
  const message = e?.message?.toLowerCase() ?? "";
  if (
    e?.status === 401 ||
    e?.status === 403 ||
    e?.code === "42501" ||
    /forbidden|unauthorized|not_authenticated/.test(message)
  )
    return "forbidden";
  if (
    error instanceof TypeError ||
    /network|failed to fetch|fetch failed|load failed/.test(message)
  )
    return "network";
  return "backend";
}
