import { FONT_STACKS } from '../../domain/appearance/apply';
import { accentTokens, paletteTokens } from '../../domain/appearance/palettes';
import { DEFAULT_APPEARANCE, DENSITIES, FONT_LABEL, FONT_SIZES, FONTS, MOTIONS, PALETTE_LABEL, PALETTES, SIZE_LABEL, THEMES, type Appearance } from '../../domain/appearance/types';
import { readEnv } from '../../state/appearanceEnv';
import { useApp } from '../../state/store';
import { Button, Chip } from '../../ui/primitives';

const THEME_LABEL = { system: 'Match my device', light: 'Light', dark: 'Dark' } as const;
const MOTION_LABEL = { system: 'Match my device', reduced: 'Reduce movement', full: 'Allow movement' } as const;
const DENSITY_LABEL = { comfortable: 'Comfortable', compact: 'Compact' } as const;

/**
 * How the app looks. Everything here is only appearance: it never changes what is planned or recorded. Colours are always adjusted
 * until text stays readable, and the app says when it did that. Fonts are the ones already on the device, so nothing is downloaded.
 */
export const AppearancePanel = () => {
  const { data, dispatch } = useApp();
  const a = data.appearance;
  const set = (patch: Partial<Appearance>) => dispatch({ type: 'APPEARANCE_SET', patch });
  const env = readEnv();
  const mode = a.theme === 'system' ? (env.prefersDark ? 'dark' : 'light') : a.theme;
  const custom = a.accent ? accentTokens(a.accent, a.palette, mode) : null;
  const shown = custom ? custom.tokens['--primary'] : paletteTokens(a.palette, mode)['--primary'];
  const changed = JSON.stringify(a) !== JSON.stringify(DEFAULT_APPEARANCE);
  return (
    <section className="card stack" aria-labelledby="s-look" data-testid="appearance">
      <h2 id="s-look" className="h3">Appearance</h2>
      <div className="field"><span className="label" id="ap-theme">Light or dark</span>
        <div className="chips" role="radiogroup" aria-labelledby="ap-theme">{THEMES.map((t) => <Chip small key={t} role="radio" on={a.theme === t} onClick={() => set({ theme: t })}>{THEME_LABEL[t]}</Chip>)}</div></div>
      <div className="field"><span className="label" id="ap-pal">Colours</span>
        <div className="chips" role="radiogroup" aria-labelledby="ap-pal">{PALETTES.map((p) => (
          <Chip small key={p} role="radio" on={a.palette === p} onClick={() => set({ palette: p })} aria-label={PALETTE_LABEL[p]}>
            <span aria-hidden style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 7, background: paletteTokens(p, mode)['--primary'], marginRight: 6, verticalAlign: '-2px', border: '1px solid var(--line-strong)' }} />{PALETTE_LABEL[p]}
          </Chip>
        ))}</div></div>
      <div className="field">
        <label htmlFor="ap-accent">Your own accent colour (optional)</label>
        <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
          <input id="ap-accent" type="color" value={a.accent ?? shown} onChange={(e) => set({ accent: e.target.value })} style={{ width: 52, height: 44, padding: 2 }} aria-describedby="ap-accent-note" />
          {a.accent && <Button size="sm" variant="ghost" onClick={() => set({ accent: null })}>Use the palette's own colour</Button>}
        </div>
        <span id="ap-accent-note" className="small muted" role="status">
          {!a.accent ? 'Pick any colour. If text on it would be hard to read, it is nudged until it is readable.'
            : custom?.adjusted ? `Your colour was adjusted a little so buttons and text stay readable. Shown: ${shown}.`
            : 'Your colour is readable as it is.'}
        </span>
      </div>
      <div className="field"><span className="label" id="ap-font">Text style</span>
        <div className="chips" role="radiogroup" aria-labelledby="ap-font">{FONTS.map((f) => <Chip small key={f} role="radio" on={a.font === f} onClick={() => set({ font: f })} style={{ fontFamily: FONT_STACKS[f].body }}>{FONT_LABEL[f]}</Chip>)}</div>
        <span className="small muted">These use fonts already on your device, so nothing is downloaded.</span></div>
      <div className="field"><span className="label" id="ap-size">Text size</span>
        <div className="chips" role="radiogroup" aria-labelledby="ap-size">{FONT_SIZES.map((s) => <Chip small key={s} role="radio" on={a.fontSize === s} onClick={() => set({ fontSize: s })}>{SIZE_LABEL[s]}</Chip>)}</div></div>
      <div className="field"><span className="label" id="ap-dens">Spacing</span>
        <div className="chips" role="radiogroup" aria-labelledby="ap-dens">{DENSITIES.map((d) => <Chip small key={d} role="radio" on={a.density === d} onClick={() => set({ density: d })}>{DENSITY_LABEL[d]}</Chip>)}</div></div>
      <div className="field"><span className="label" id="ap-motion">Movement and animation</span>
        <div className="chips" role="radiogroup" aria-labelledby="ap-motion">{MOTIONS.map((m) => <Chip small key={m} role="radio" on={a.motion === m} onClick={() => set({ motion: m })}>{MOTION_LABEL[m]}</Chip>)}</div></div>
      <label className="row between switch-row"><span><b>Show the owl</b><br /><span className="small muted">A small helper that points out features. It never covers a button and you can hide it any time.</span></span>
        <input type="checkbox" role="switch" aria-label="Show the owl" checked={a.owl} onChange={(e) => set({ owl: e.target.checked })} style={{ width: 24, height: 24 }} /></label>
      {changed && <div><Button variant="secondary" onClick={() => dispatch({ type: 'APPEARANCE_SET', patch: DEFAULT_APPEARANCE })}>Reset appearance</Button></div>}
    </section>
  );
};
