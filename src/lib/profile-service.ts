/** Per-user preferences stored on the user's own profile row (RLS: own row only). */
import { supabase } from "@/integrations/supabase/client";
import { LANGUAGES, resolveClientLanguage, setLanguage, type LanguageCode } from "@/lib/i18n";

const isLang = (v: unknown): v is LanguageCode => LANGUAGES.some((l) => l.code === v);

/** Apply the signed-in user's saved language (falls back to device preference). Call from useEffect. */
export async function applyUserLanguage(userId: string) {
  setLanguage(resolveClientLanguage());
  const { data } = await supabase
    .from("profiles")
    .select("preferred_language")
    .eq("id", userId)
    .maybeSingle();
  if (isLang(data?.preferred_language)) setLanguage(data.preferred_language);
}

/** Change language now and remember it for this account on every device. */
export async function chooseLanguage(userId: string | undefined, code: LanguageCode) {
  setLanguage(code);
  if (userId) await supabase.from("profiles").update({ preferred_language: code }).eq("id", userId);
}
