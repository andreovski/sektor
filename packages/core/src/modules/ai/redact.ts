// Antes de enviar a um modelo: CPF, CNPJ, cartão e número de conta saem do texto.

const RULES: [RegExp, string][] = [
  // CNPJ antes do CPF: os dois começam igual sem máscara.
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]'],
  // Cartão: 13 a 19 dígitos, com ou sem espaço ou hífen a cada 4.
  [/\b(?:\d[ -]?){12,18}\d\b/g, '[CARTÃO]'],
  // Agência e conta escritas como tal.
  [/\b(ag(?:ência|encia|\.)?|conta|c\/c|cc)\s*:?\s*\d[\d.-]{2,}\d\b/gi, '$1 [NÚMERO]'],
];

export function redact(text: string): string {
  return RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
