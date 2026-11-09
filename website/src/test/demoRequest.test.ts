import {
  buildWhatsAppMessage,
  emptyDemoRequest,
  submitDemoRequest,
  submitErrorMessage,
  validateDemoRequest,
  type DemoRequest,
} from "../lib/demoRequest";

const valid: DemoRequest = {
  ...emptyDemoRequest,
  name: "Alex Rivera",
  email: "alex@example.com",
  restaurant: "Example Kitchen",
  locations: "1 location",
  role: "Owner",
  consent: true,
};

describe("validateDemoRequest", () => {
  it("accepts a complete request", () => {
    expect(validateDemoRequest(valid)).toEqual({});
  });

  it("flags every required field on an empty form", () => {
    const errors = validateDemoRequest(emptyDemoRequest);
    expect(Object.keys(errors).sort()).toEqual(["consent", "email", "locations", "name", "restaurant", "role"]);
  });

  it("rejects malformed emails", () => {
    expect(validateDemoRequest({ ...valid, email: "alex@" }).email).toBeDefined();
    expect(validateDemoRequest({ ...valid, email: "alex example.com" }).email).toBeDefined();
  });

  it("treats phone as optional but validates it when present", () => {
    expect(validateDemoRequest({ ...valid, phone: "" }).phone).toBeUndefined();
    expect(validateDemoRequest({ ...valid, phone: "(555) 555-0123" }).phone).toBeUndefined();
    expect(validateDemoRequest({ ...valid, phone: "123" }).phone).toBeDefined();
  });

  it("only accepts listed location and role options", () => {
    expect(validateDemoRequest({ ...valid, locations: "999" }).locations).toBeDefined();
    expect(validateDemoRequest({ ...valid, role: "CEO" }).role).toBeDefined();
  });
});

describe("submitDemoRequest", () => {
  it("never sends anything when no endpoint is configured", async () => {
    const fetcher = vi.fn();
    await expect(submitDemoRequest(valid, null, fetcher)).resolves.toEqual({ status: "not-configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("posts trimmed JSON to the configured endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await submitDemoRequest({ ...valid, name: "  Alex Rivera  " }, "https://forms.example.com/demo", fetcher);
    expect(result).toEqual({ status: "sent" });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://forms.example.com/demo");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ name: "Alex Rivera", email: "alex@example.com", phone: null });
  });

  it("reports server errors instead of claiming success", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    await expect(submitDemoRequest(valid, "https://forms.example.com/demo", fetcher)).resolves.toMatchObject({ status: "error" });
  });

  it("reports network failures", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(submitDemoRequest(valid, "https://forms.example.com/demo", fetcher)).resolves.toMatchObject({ status: "error" });
  });
});

describe("demo request in Portuguese", () => {
  it("returns Portuguese validation messages", () => {
    const errors = validateDemoRequest(emptyDemoRequest, "pt");
    expect(errors.name).toBe("Informe seu nome completo.");
    expect(errors.consent).toMatch(/Confirme/);
  });

  it("sends the visitor's language with the request", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await submitDemoRequest(valid, "https://forms.example.com/demo", fetcher, "pt");
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ language: "pt", locations: "1 location", role: "Owner" });
  });

  it("describes server errors in the visitor's language", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    const result = await submitDemoRequest(valid, "https://forms.example.com/demo", fetcher, "pt");
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(submitErrorMessage(result, "pt")).toBe("O servidor respondeu com o status 503.");
    expect(submitErrorMessage(result, "en")).toBe("The server responded with status 503.");
  });
});

describe("WhatsApp hand-off message", () => {
  it("includes the visitor's details in their language and skips empty optional fields", () => {
    const en = buildWhatsAppMessage(valid, "en");
    expect(en).toContain("Name: Alex Rivera");
    expect(en).toContain("Locations: 1 location");
    expect(en).not.toContain("Phone:");
    const pt = buildWhatsAppMessage({ ...valid, phone: "(508) 555-0100", message: "Quero ver o KDS." }, "pt");
    expect(pt).toContain("Função: Dono(a)");
    expect(pt).toContain("Telefone: (508) 555-0100");
    expect(pt.endsWith("Quero ver o KDS.")).toBe(true);
  });
});
