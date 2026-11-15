/**
 * Centralizirana konfiguracija UI tema akcenta (usklađeno s [data-theme] pravilima u src/index.css).
 */
export const UI_THEMES = [
  {
    id: 'volt',
    name: 'Carbon & Acid Volt',
    tag: 'ZADANO',
    desc: 'Fluorescentna trkaća zelena maksimalnog kontrasta na karbonskoj podlozi.',
    swatch: '#a3e635'
  },
  {
    id: 'titanium',
    name: 'Titanium Champagne',
    tag: 'PROFINJENO',
    desc: 'Topla prigušena titanijumsko-zlatna nijansa — ugodna za svakodnevni rad bez umora očiju.',
    swatch: '#d6b26e'
  },
  {
    id: 'emerald',
    name: 'Sage Emerald',
    tag: 'MIRNO',
    desc: 'Čista, smirena smaragdna nijansa koja rasterećuje pogled u odnosu na kiseli neon.',
    swatch: '#34d399'
  },
  {
    id: 'amber',
    name: 'Copper Amber',
    tag: 'TOPLO',
    desc: 'Topli instrumentni jantar i bakar — blaži i prirodniji od jarke crveno-narančaste.',
    swatch: '#f59e0b'
  },
  {
    id: 'platinum',
    name: 'Monochrome Platinum',
    tag: 'MINIMAL',
    desc: 'Minimalistički metalik-srebrni izgled gdje boju nose isključivo zone snage i kalendar.',
    swatch: '#e4e4e7'
  },
  {
    id: 'corsa',
    name: 'Atelier Corsa',
    tag: 'UTRKA',
    desc: 'Talijanska natjecateljska crveno-narančasta za agresivan trkaći kokpit.',
    swatch: '#ff4d1c'
  },
  {
    id: 'aero',
    name: 'Stealth Aero',
    tag: 'AERO',
    desc: 'Hladna ledeno-plava telemetrija inspirirana zračnim tunelom.',
    swatch: '#38bdf8'
  }
];

export const VALID_UI_THEME_IDS = UI_THEMES.map(t => t.id);
