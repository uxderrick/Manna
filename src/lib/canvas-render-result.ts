export function renderAndReport<T>(
  render: () => T,
  report?: (result: T) => void,
): T {
  const result = render()
  report?.(result)
  return result
}
