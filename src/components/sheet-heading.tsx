import { SheetSceneHeading } from '@/components/sheet-scene';

/**
 * A sheet's title and the line under it.
 *
 * One implementation, in `sheet-scene.tsx`, so "every sheet announces itself
 * the same way" is a fact rather than two files that agree today. This name
 * survives because the sheets that predate the scene -- settings, the
 * catalogue, new task, web service -- import it, and they are still built on
 * their own scroll roots.
 */
export function SheetHeading({ title, caption }: { title: string; caption?: string }) {
  return <SheetSceneHeading title={title} caption={caption} />;
}
