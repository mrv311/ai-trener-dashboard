/**
 * Centralizirana konfiguracija UI tema akcenta (usklađeno s [data-theme] pravilima u src/index.css).
 */
export const UI_THEMES = [
  {
    id: 'volt',
    name: 'Carbon & Acid Volt',
    tag: 'ZADANO',
    tagEn: 'DEFAULT',
    desc: 'Fluorescentna trkaća zelena maksimalnog kontrasta na karbonskoj podlozi.',
    descEn: 'High-contrast fluorescent racing volt on a carbon-dark telemetry canvas.',
    swatch: '#a3e635'
  },
  {
    id: 'titanium',
    name: 'Titanium Champagne',
    tag: 'PROFINJENO',
    tagEn: 'REFINED',
    desc: 'Topla prigušena titanijumsko-zlatna nijansa — ugodna za svakodnevni rad bez umora očiju.',
    descEn: 'Warm muted titanium gold — easy on the eyes for long analysis sessions.',
    swatch: '#d6b26e'
  },
  {
    id: 'emerald',
    name: 'Sage Emerald',
    tag: 'MIRNO',
    tagEn: 'CALM',
    desc: 'Čista, smirena smaragdna nijansa koja rasterećuje pogled u odnosu na kiseli neon.',
    descEn: 'Clean, calm emerald accent that softens contrast compared to acid neon.',
    swatch: '#34d399'
  },
  {
    id: 'amber',
    name: 'Copper Amber',
    tag: 'TOPLO',
    tagEn: 'WARM',
    desc: 'Topli instrumentni jantar i bakar — blaži i prirodniji od jarke crveno-narančaste.',
    descEn: 'Warm instrument amber & copper — softer and more natural than bright red-orange.',
    swatch: '#f59e0b'
  },
  {
    id: 'platinum',
    name: 'Monochrome Platinum',
    tag: 'MINIMAL',
    tagEn: 'MINIMAL',
    desc: 'Minimalistički metalik-srebrni izgled gdje boju nose isključivo zone snage i kalendar.',
    descEn: 'Minimalist metallic silver look where only power zones and calendar carry color.',
    swatch: '#e4e4e7'
  },
  {
    id: 'corsa',
    name: 'Atelier Corsa',
    tag: 'UTRKA',
    tagEn: 'RACE',
    desc: 'Talijanska natjecateljska crveno-narančasta za agresivan trkaći kokpit.',
    descEn: 'Italian racing red-orange for an aggressive race cockpit feel.',
    swatch: '#ff4d1c'
  },
  {
    id: 'aero',
    name: 'Stealth Aero',
    tag: 'AERO',
    tagEn: 'AERO',
    desc: 'Hladna ledeno-plava telemetrija inspirirana zračnim tunelom.',
    descEn: 'Cool ice-blue wind-tunnel telemetry aesthetic.',
    swatch: '#38bdf8'
  }
];

export const VALID_UI_THEME_IDS = UI_THEMES.map(t => t.id);
