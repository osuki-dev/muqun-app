import { createElement, useEffect, useState, type ReactNode } from 'react';
import {
  DiagramProvider,
  type DiagramExpandIconProps,
  type DiagramViewerIconProps,
} from '@osuki-dev/skia-diagrams/react';
import { DoneIcon, CopyIcon, FullscreenIcon, CloseIcon } from '@/icons';
import { Skia, type SkTypefaceFontProvider } from 'react-native-skia';
import { useDiagramTheme } from '@/hooks/use-diagram-theme';
import { useAppSettings } from '@/stores/app-settings';
import { slotFontFamily, userFontUri, type FontSlot } from '@/theme/user-fonts';

function renderDiagramExpandIcon({ color, size }: DiagramExpandIconProps) {
  return createElement(FullscreenIcon, { color, size });
}

function renderDiagramViewerIcon({ action, color, size }: DiagramViewerIconProps) {
  const Icon = { close: CloseIcon, fit: FullscreenIcon, copy: CopyIcon, success: DoneIcon }[action];
  return createElement(Icon, { color, size });
}

async function loadDiagramFonts(interfaceFont: FontSlot, monoFont: FontSlot) {
  const provider = Skia.TypefaceFontProvider.Make();
  await Promise.all(
    (
      [
        ['interface', interfaceFont],
        ['mono', monoFont],
      ] as const
    ).map(async ([slot, font]) => {
      const uri = userFontUri(font);
      const family = slotFontFamily(font, slot);
      if (!uri || !family) return;
      const data = await Skia.Data.fromURI(uri);
      try {
        const face = Skia.Typeface.MakeFreeTypeFaceFromData(data);
        if (face) {
          provider.registerFont(face, family);
          face.dispose();
        }
      } finally {
        data.dispose();
      }
    })
  );
  return provider;
}

/** Share host-owned custom faces across all diagrams instead of loading per message. */
export function AppDiagramProvider({ children }: { children: ReactNode }) {
  const theme = useDiagramTheme();
  const interfaceFont = useAppSettings((state) => state.interfaceFont);
  const monoFont = useAppSettings((state) => state.monoFont);
  const [fonts, setFonts] = useState<{
    interfaceFont: FontSlot;
    monoFont: FontSlot;
    provider: SkTypefaceFontProvider;
  }>();
  useEffect(() => {
    if (interfaceFont.kind !== 'file' && monoFont.kind !== 'file') return;
    let active = true;
    void loadDiagramFonts(interfaceFont, monoFont)
      .then((provider) => {
        if (active) setFonts({ interfaceFont, monoFont, provider });
      })
      .catch(() => {
        // The existing font settings surface reports invalid files; use system faces here.
        if (active) setFonts(undefined);
      });
    return () => {
      active = false;
    };
  }, [interfaceFont, monoFont]);
  const provider =
    fonts?.interfaceFont === interfaceFont && fonts.monoFont === monoFont
      ? fonts.provider
      : undefined;
  return (
    <DiagramProvider
      theme={theme}
      fontProvider={provider}
      renderExpandIcon={renderDiagramExpandIcon}
      renderViewerIcon={renderDiagramViewerIcon}>
      {children}
    </DiagramProvider>
  );
}
