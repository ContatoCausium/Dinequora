import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Send, Sparkles } from "lucide-react";

import { Panel } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askAssistant } from "@/lib/assistant.functions";

type Turn = { role: "user" | "assistant"; text: string };

/**
 * "Ask the assistant" on the Insights page (migration 0040). Shown only to members with assistant.use
 * (feature ai_assistant on for the organization). The answer comes from Claude, reading a snapshot of
 * this member's data on the server; the panel says so, and says when the assistant is not set up.
 */
export function AssistantPanel({ orgId, locationId }: { orgId: string; locationId: string }) {
  const { t } = useTranslation("intelligence");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 3) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await askAssistant({
        data: { orgId, locationId, question: text, history: turns.slice(-8) },
      });
      if (r.status === "ok") {
        setTurns((h) => [...h, { role: "user", text }, { role: "assistant", text: r.answer }]);
        setQuestion("");
      } else setNotice(t(`assistant.status.${r.status}`));
    } catch {
      setNotice(t("assistant.status.unavailable"));
    } finally {
      setBusy(false);
    }
  }

  const examples = [t("assistant.example1"), t("assistant.example2"), t("assistant.example3")];
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden />
          {t("assistant.title")}
        </span>
      }
      subtitle={t("assistant.subtitle")}
    >
      <div className="space-y-3">
        {turns.length > 0 && (
          <ol className="space-y-3" aria-live="polite">
            {turns.map((m, i) => (
              <li
                key={i}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm"
                    : "max-w-[95%] whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm leading-relaxed"
                }
              >
                <span className="sr-only">
                  {m.role === "user" ? t("assistant.you") : t("assistant.title")}:{" "}
                </span>
                {m.text}
              </li>
            ))}
          </ol>
        )}
        {turns.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {examples.map((e) => (
              <Button
                key={e}
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setQuestion(e);
                  void ask(e);
                }}
              >
                {e}
              </Button>
            ))}
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <Textarea
            aria-label={t("assistant.question")}
            placeholder={t("assistant.placeholder")}
            rows={2}
            maxLength={1000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(question);
              }
            }}
          />
          <Button type="submit" disabled={busy || question.trim().length < 3}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            {busy ? t("assistant.thinking") : t("assistant.ask")}
          </Button>
        </form>
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        <p className="text-[12px] text-muted-foreground">{t("assistant.disclaimer")}</p>
      </div>
    </Panel>
  );
}
