import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { appRoutes } from "../config/site";
import { featureCategories } from "../content/features";
import { detectInitialLocale, STORAGE_KEY } from "../i18n/locale";

beforeAll(() => {
  // jsdom lacks these browser APIs used by the layout helpers.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("Dinequora marketing site", () => {
  it("renders the hero headline and primary CTAs", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Run your restaurant\.\s*Not the chaos\./);
    const hero = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(within(hero).getByRole("link", { name: /Book a Demo/ })).toHaveAttribute("href", "#demo");
    expect(within(hero).getByRole("link", { name: "Explore the Platform" })).toHaveAttribute("href", "#platform");
  });

  it("uses the official brand kit files for the logo", () => {
    render(<App />);
    const logos = screen.getAllByAltText("Dinequora — Restaurant Intelligence Platform");
    expect(logos.length).toBeGreaterThan(0);
    for (const img of logos) expect(img.getAttribute("src")).toMatch(/^\/brand\/dinequora_.*\.svg$/);
  });

  it("links every primary nav item to an existing section", () => {
    const { container } = render(<App />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Platform", "Features", "Pricing", "Implementation", "About"]);
    for (const link of links) {
      const href = link.getAttribute("href")!;
      expect(container.querySelector(href)).not.toBeNull();
    }
    expect(container.querySelector("#demo")).not.toBeNull();
  });

  it("points Login to the existing authentication route", () => {
    render(<App />);
    const logins = screen.getAllByRole("link", { name: "Login" });
    expect(logins.length).toBeGreaterThan(0);
    for (const l of logins) expect(l).toHaveAttribute("href", appRoutes.login);
    expect(appRoutes.login.endsWith("/auth")).toBe(true);
    expect(appRoutes.signup.endsWith("/signup")).toBe(true);
  });

  it("has no in-page links pointing at missing anchors", () => {
    const { container } = render(<App />);
    const anchors = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    expect(anchors.length).toBeGreaterThan(10);
    for (const a of anchors) {
      const id = a.getAttribute("href")!.slice(1);
      expect(id === "" || container.querySelector(`#${CSS.escape(id)}`) !== null, `missing #${id}`).toBe(true);
    }
  });

  it("shows prices with separate implementation fees", () => {
    render(<App />);
    const pricing = document.getElementById("pricing")!;
    const growth = within(pricing).getByRole("article", { name: "Growth" });
    expect(growth).toHaveTextContent("$119");
    expect(growth).toHaveTextContent("One-time implementation$349");
    expect(growth).toHaveTextContent("Most Popular");
    const enterprise = within(pricing).getByRole("article", { name: "Enterprise" });
    expect(enterprise).toHaveTextContent("From $799");
    expect(enterprise).toHaveTextContent("Subject to scope and contract");
  });

  it("labels AI capabilities as upcoming, not available", () => {
    render(<App />);
    const ai = screen.getByRole("heading", { name: /next generation of restaurant intelligence/i }).closest("section")!;
    expect(ai).toHaveTextContent("Not yet available");
    expect(within(ai).getAllByText("In development")).toHaveLength(6);
    expect(within(ai).queryByRole("button")).toBeNull();
  });

  it("tells one service night in three chapters, with availability badges", () => {
    render(<App />);
    for (const name of ["Chapter 1: before service", "Chapter 2: the rush", "Chapter 3: closing"])
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    const close = screen.getByRole("region", { name: "Chapter 3: closing" });
    const finance = featureCategories.find((c) => c.id === "finance")!;
    for (const cap of finance.capabilities.slice(0, 4)) expect(close).toHaveTextContent(cap.name);
    expect(within(close).getAllByText("Rolling out").length).toBeGreaterThan(0);
    // Charts are illustrative and say so.
    expect(close).toHaveTextContent("Sample data");
  });

  it("hands the demo request to WhatsApp without an endpoint and never claims delivery", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<App />);
    const submit = screen.getByRole("button", { name: "Continue on WhatsApp" });
    await user.click(submit);
    expect(screen.getByText("Please enter your full name.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Full name"), "Alex Rivera");
    await user.type(screen.getByLabelText("Work email"), "alex@example.com");
    await user.type(screen.getByLabelText("Restaurant or group"), "Example Kitchen");
    await user.selectOptions(screen.getByLabelText("Number of locations"), "1 location");
    await user.selectOptions(screen.getByLabelText("Your role"), "Owner");
    await user.click(screen.getByLabelText(/I agree that Dinequora may contact me/));
    await user.click(submit);

    expect(open).toHaveBeenCalledTimes(1);
    const url = new URL(String(open.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://wa.me/15087149654");
    expect(url.searchParams.get("text")).toContain("Name: Alex Rivera");
    expect(url.searchParams.get("text")).toContain("Restaurant: Example Kitchen");
    expect(await screen.findByText("Almost there.")).toBeInTheDocument();
    expect(screen.queryByText(/Your request was received/)).toBeNull();
    open.mockRestore();
  });

  it("advances product screens automatically when the progress bar completes", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tablist = screen.getByRole("tablist", { name: "Product screens" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    const bar = tabs[0]!.querySelector(".rotate-progress")!;
    // jsdom has no CSS animations; React may listen for the prefixed event name there.
    fireEvent.animationEnd(bar);
    if (within(tablist).getAllByRole("tab")[0]!.getAttribute("aria-selected") === "true")
      fireEvent(bar, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(within(tablist).getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
    // Only the active screen is exposed to assistive technology.
    expect(screen.getAllByRole("tabpanel", { name: /Point of sale/ })).toHaveLength(1);

    const section = tablist.closest("section")!;
    const pause = within(section).getByRole("button", { name: "Pause automatic rotation" });
    await user.click(pause);
    expect(within(section).getByRole("button", { name: "Resume automatic rotation" })).toBeInTheDocument();
    const activeBar = within(tablist).getAllByRole("tab")[1]!.querySelector<HTMLElement>(".rotate-progress")!;
    expect(activeBar.style.animationPlayState).toBe("paused");
  });

  it("links every WhatsApp button to the sales number", () => {
    const { container } = render(<App />);
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="https://wa.me/"]')];
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const a of links) {
      expect(a.href.startsWith("https://wa.me/15087149654")).toBe(true);
      expect(a.target).toBe("_blank");
      expect(a.rel).toContain("noopener");
    }
    expect(screen.getAllByText("+1 (508) 714-9654").length).toBeGreaterThan(0);
  });
});

describe("Portuguese version", () => {
  it("switches the whole page to Portuguese from the language selector", async () => {
    const user = userEvent.setup();
    render(<App />);
    const switcher = screen.getAllByRole("group", { name: "Language" })[0]!;
    await user.click(within(switcher).getByRole("button", { name: "Português" }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Comande seu restaurante\.\s*Não o caos\./);
    expect(document.documentElement.lang).toBe("pt-BR");
    expect(document.title).toMatch(/Plataforma de Inteligência para Restaurantes/);
    expect(window.location.search).toBe("?lang=pt");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("pt");

    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Plataforma",
      "Recursos",
      "Preços",
      "Implantação",
      "Sobre",
    ]);
    expect(screen.getAllByRole("link", { name: "Entrar" })[0]).toHaveAttribute("href", appRoutes.login);
  });

  it("switches back to English and drops the URL parameter", async () => {
    const user = userEvent.setup();
    render(<App initialLocale="pt" />);
    const switcher = screen.getAllByRole("group", { name: "Idioma" })[0]!;
    await user.click(within(switcher).getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Run your restaurant/);
    expect(document.documentElement.lang).toBe("en-US");
    expect(window.location.search).toBe("");
  });

  it("keeps the same prices in US dollars", () => {
    render(<App initialLocale="pt" />);
    const pricing = document.getElementById("pricing")!;
    const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ");
    const growth = within(pricing).getByRole("article", { name: "Growth" });
    expect(text(growth)).toContain("US$ 119");
    expect(text(growth)).toContain("Implantação (pagamento único)US$ 349");
    expect(growth).toHaveTextContent("Mais popular");
    const enterprise = within(pricing).getByRole("article", { name: "Enterprise" });
    expect(text(enterprise)).toContain("A partir de US$ 799");
    expect(enterprise).toHaveTextContent("Sujeito a escopo e contrato");
  });

  it("keeps AI capabilities labeled as not yet available", () => {
    render(<App initialLocale="pt" />);
    const ai = screen.getByRole("heading", { name: /próxima geração/i }).closest("section")!;
    expect(ai).toHaveTextContent("Ainda não disponível");
    expect(within(ai).getAllByText("Em desenvolvimento")).toHaveLength(6);
    expect(within(ai).queryByRole("button")).toBeNull();
  });

  it("shows translated product screens and charts, labeled as illustrative", () => {
    render(<App initialLocale="pt" />);
    const close = screen.getByRole("region", { name: "Capítulo 3: o fechamento" });
    expect(close).toHaveTextContent("Resultado estimado");
    expect(close).toHaveTextContent("Dados de exemplo");
    expect(close).not.toHaveTextContent("Estimated net");
    expect(document.body).toHaveTextContent("Dinequora · Financeiro");
    expect(document.body).toHaveTextContent("Hoje o aplicativo é em inglês");
  });

  it("says the app interface is in English", () => {
    render(<App initialLocale="pt" />);
    expect(screen.getByText("O sistema está em português?")).toBeInTheDocument();
    expect(document.getElementById("faq")).toHaveTextContent("A interface do aplicativo Dinequora hoje é em inglês");
  });

  it("validates the form in Portuguese and never claims delivery", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<App initialLocale="pt" />);
    const submit = screen.getByRole("button", { name: "Continuar no WhatsApp" });
    await user.click(submit);
    expect(screen.getByText("Informe seu nome completo.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Nome completo"), "Ana Souza");
    await user.type(screen.getByLabelText("E-mail profissional"), "ana@example.com");
    await user.type(screen.getByLabelText("Restaurante ou grupo"), "Cozinha Exemplo");
    await user.selectOptions(screen.getByLabelText("Número de unidades"), "1 unidade");
    await user.selectOptions(screen.getByLabelText("Sua função"), "Dono(a)");
    await user.click(screen.getByLabelText(/Concordo que o Dinequora/));
    await user.click(submit);

    const text = new URL(String(open.mock.calls[0]?.[0])).searchParams.get("text") ?? "";
    expect(text).toContain("Olá! Gostaria de agendar uma demonstração do Dinequora.");
    expect(text).toContain("Unidades: 1 unidade");
    expect(await screen.findByText("Quase lá.")).toBeInTheDocument();
    expect(screen.queryByText(/foi recebida/)).toBeNull();
    open.mockRestore();
  });

  it("translates visible form errors when the language changes", async () => {
    const user = userEvent.setup();
    render(<App initialLocale="en" />);
    await user.click(screen.getByRole("button", { name: "Continue on WhatsApp" }));
    expect(screen.getByText("Please enter your full name.")).toBeInTheDocument();
    const switcher = screen.getAllByRole("group", { name: "Language" })[0]!;
    await act(() => user.click(within(switcher).getByRole("button", { name: "Português" })));
    expect(screen.getByText("Informe seu nome completo.")).toBeInTheDocument();
    expect(screen.queryByText("Please enter your full name.")).toBeNull();
  });
});

describe("initial language detection", () => {
  it("prefers the URL parameter, then the saved choice, then English", () => {
    window.history.replaceState(null, "", "/?lang=pt");
    expect(detectInitialLocale()).toBe("pt");
    window.history.replaceState(null, "", "/");
    window.localStorage.setItem(STORAGE_KEY, "pt");
    expect(detectInitialLocale()).toBe("pt");
    window.localStorage.clear();
    expect(detectInitialLocale()).toBe("en");
  });
});
