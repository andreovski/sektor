// Dinheiro sempre em centavos (inteiro): soma de ponto flutuante erra centavos em extrato longo.

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`Valor em centavos precisa ser inteiro: ${cents}`);
  }
  return BRL.format(cents / 100);
}

/**
 * Converte o que a pessoa digita ("1.234,56", "R$ 10", "-3,5") em centavos.
 * Devolve null quando o texto não é um valor.
 */
export function parseCents(input: string): number | null {
  const limpo = input.replace(/R\$|\s/g, '');
  if (!/^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(,\d{1,2})?$/.test(limpo)) return null;

  const negativo = limpo.startsWith('-');
  const [inteiro, decimal = ''] = limpo.replace('-', '').replace(/\./g, '').split(',');
  const cents = Number(inteiro) * 100 + Number(decimal.padEnd(2, '0'));
  return negativo ? -cents : cents;
}
