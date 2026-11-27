/**
 * Accent- and case-insensitive search text (command palette keywords): cmdk scores the item value
 * plus its keywords, so "relatorios" finds "Relatórios" and "configuracoes" finds "Configurações".
 */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}
