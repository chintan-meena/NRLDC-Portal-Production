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
  Factory, Sprout, Landmark, ArrowLeftRight,
  Sun, Wind, BatteryCharging, Droplets, Flame, Atom, Fuel,
  SlidersHorizontal, CalendarClock, TrendingDown, Siren, Handshake,
  RadioTower, Unplug, PowerOff, Tag,
  Clock, CheckCircle2, XCircle, PhoneOutgoing, HelpCircle,
} from 'lucide-react';

// ── Energy categories ────────────────────────────────────────────────────────
const CATEGORY_ICONS = {
  ISGS: Factory,
  RE: Sprout,
  States: Landmark,
  Traders: ArrowLeftRight,
};

export function CategoryIcon({ category, size = 14, ...rest }) {
  const Icon = CATEGORY_ICONS[category] || HelpCircle;
  return <Icon size={size} aria-hidden="true" {...rest} />;
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
