export function setCasesChecked(
  selected: ReadonlySet<string>,
  cases: readonly { id: string }[],
  checked: boolean,
) {
  const next = new Set(selected);
  for (const { id } of cases) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}
