/** The preferred device locale controls this footer, independently of App language. */
export function icpRegistration(regionCode: string | null | undefined, number?: string) {
  const label = number?.trim();
  return regionCode?.toUpperCase() === 'CN' && label ? label : null;
}
