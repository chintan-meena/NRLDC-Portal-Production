import { createElement } from 'react';
import { ICON_PATHS } from './iconPaths';

/**
 * Icon — the in-house design set (svg/), rendered inline so it inherits color.
 *
 * Every glyph is drawn with stroke="currentColor", so an icon simply takes the
 * CSS `color` of whatever it sits in — no per-file editing, and hover / active /
 * disabled states come free from the parent's color. Set the color on the
 * container (e.g. a nav tab), not here.
 *
 *   <Icon name="unit-outages" />                      // inherits currentColor
 *   <span style={{color:'var(--danger-text)'}}><Icon name="discrepancy-alert" /></span>
 *
 * Two-tone: pass `accentColor` (and optionally `accentIndex`, default the last
 * path) to lift one stroke — the red flag on a discrepancy, amber on an outage —
 * while the rest stays currentColor.
 *
 * Decorative by default (aria-hidden), because icons here sit beside a real text
 * label. Pass `title` only when the icon stands alone and must be announced.
 */
export default function Icon({
  name,
  size = 20,
  strokeWidth = 1.75,
  title,
  className = '',
  style,
  accentColor,
  accentIndex,
  ...rest
}) {
  const els = ICON_PATHS[name];
  if (!els) {
    if (import.meta.env && import.meta.env.DEV) {
      console.warn(`<Icon>: unknown icon "${name}"`);
    }
    return null;
  }

  const labelled = Boolean(title);
  const accentAt = accentColor != null
    ? (accentIndex == null ? els.length - 1 : accentIndex)
    : -1;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      className={`icon icon-${name}${className ? ` ${className}` : ''}`}
      style={style}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      {...rest}
    >
      {labelled ? <title>{title}</title> : null}
      {els.map((el, i) => {
        const { tag, ...attrs } = el;
        if (i === accentAt) attrs.stroke = accentColor;
        return createElement(tag, { key: i, ...attrs });
      })}
    </svg>
  );
}
