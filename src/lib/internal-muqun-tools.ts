const OPERATIONS = [
  'exec.run',
  'tasks.delegate',
  'tasks.wait',
  'tasks.read',
  'tasks.cancel',
  'tasks.complete',
  'fleet.list',
  'fleet.describe',
] as const;
export type MuqunOperation = (typeof OPERATIONS)[number];

/** Identify this MCP server exactly; tool visibility is never suppressed here. */
export function muqunOperation(name: string): MuqunOperation | undefined {
  const prefix = ['mcp__muqun__', 'muqun__', 'muqun_', 'muqun.', 'muqun:'].find((value) =>
    name.startsWith(value)
  );
  if (!prefix) return undefined;
  const tool = name.slice(prefix.length);
  return OPERATIONS.find((operation) => tool === operation || tool === operation.replace('.', '_'));
}
