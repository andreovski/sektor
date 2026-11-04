// Os campos do app não são nativos: select e data abrem painéis. Estes ajudantes fazem o que
// `selectOption` e `fill('AAAA-MM-DD')` faziam nos elementos nativos.

/** Abre o select e escolhe a opção pelo valor visível. */
export async function choose(page, trigger, label) {
  await trigger.click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

/** Abre o calendário do campo de data e anda pelos meses até o dia `iso`. */
export async function pickDate(page, trigger, iso) {
  await trigger.click();
  const panel = page.locator('[data-radix-popper-content-wrapper]').last();
  for (let step = 0; step < 48 && !(await panel.locator(`[data-day="${iso}"]`).count()); step++) {
    const shown = await panel.locator('[data-day]').nth(10).getAttribute('data-day');
    await panel.getByRole('button', { name: iso > shown ? 'Próximo mês' : 'Mês anterior' }).click();
  }
  await panel.locator(`[data-day="${iso}"]`).click();
}
