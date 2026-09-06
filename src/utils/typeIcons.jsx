/**
 * typeIcons.jsx — one place that maps a "type" to its icon.
 *
 * Every screen draws the same lucide icon for a given energy category,
 * generation type, discrepancy tag or consent state, so the visual language
 * stays consistent. Icons are decorative (aria-hidden) — the text label is
 * always kept alongside for accessibility.
 *
 * lucide-react is bundled with the app, so this adds no network request and
 * stays within the portal's strict CSP (no external icon images).
 */

import {
  Sprout,
  Sun, Wind, BatteryCharging, Droplets, Flame, Atom, Fuel,
  SlidersHorizontal, CalendarClock, TrendingDown, Siren, Handshake,
  RadioTower, Unplug, PowerOff, Tag,
  Clock, CheckCircle2, XCircle, PhoneOutgoing, HelpCircle,
} from 'lucide-react';
import Icon from '../components/Icon';

// ── Energy categories ────────────────────────────────────────────────────────
// Category → in-house glyph (src/assets/icons, via components/Icon), so the
// whole app speaks one visual language. Colour comes from the surrounding
// context — an .energy-badge, or the category filter row — because every glyph
// is stroke="currentColor".
const CATEGORY_ICON_NAME = {
  ISGS: 'regional-entity',
  RE: 'renewable',
  States: 'states',
  Traders: 'traders',
  QCA: 'renewable',
};

export function CategoryIcon({ category, size = 14, ...rest }) {
  return <Icon name={CATEGORY_ICON_NAME[category] || 'all-categories'} size={size} {...rest} />;
}

// ── Generation types (parsed from the plant name or generator_type) ──────────
const GENERATION_MATCHERS = [
  [/\bsolar\b/i, Sun],
  [/\bwind\b/i, Wind],
  [/\bbess\b|batter/i, BatteryCharging],
  [/\bhydro\b/i, Droplets],
  [/\bthermal\b|\bcoal\b/i, Flame],
  [/\bnuclear\b/i, Atom],
  [/\bgas\b/i, Fuel],
  [/\brenewable\b/i, Sprout],
];

/** Icon for a generation type. `source` can be a plant name or generator_type. */
export function GenerationIcon({ source, size = 14, ...rest }) {
  const s = String(source || '');
  const match = GENERATION_MATCHERS.find(([re]) => re.test(s));
  if (!match) return null;
  const Icon = match[1];
  return <Icon size={size} aria-hidden="true" {...rest} />;
}

// ── Discrepancy type tags ────────────────────────────────────────────────────
const DISCREPANCY_MATCHERS = [
  [/SCED/i, SlidersHorizontal],
  [/SCUC/i, CalendarClock],
  [/shortfall/i, TrendingDown],
  [/emergency/i, Siren],
  [/bilateral|GNA/i, Handshake],
  [/real[- ]?time|NLDC/i, RadioTower],
  [/schedule loss/i, Unplug],
  [/outage/i, PowerOff],
];

/** Icon for a single discrepancy-type tag (its display text). */
export function DiscrepancyTypeIcon({ type, size = 13, ...rest }) {
  const t = String(type || '');
  const match = DISCREPANCY_MATCHERS.find(([re]) => re.test(t));
  const Icon = match ? match[1] : Tag;
  return <Icon size={size} aria-hidden="true" {...rest} />;
}

// ── Consent / trade states ───────────────────────────────────────────────────
const CONSENT_ICONS = {
  Awaiting: Clock,
  Consented: CheckCircle2,
  Refused: XCircle,
};

/** Icon for a consent state; when `offline` it's the off-portal (phone) mark. */
export function ConsentIcon({ state, offline = false, size = 14, ...rest }) {
  const Icon = offline ? PhoneOutgoing : (CONSENT_ICONS[state] || HelpCircle);
  return <Icon size={size} aria-hidden="true" {...rest} />;
}
