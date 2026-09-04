/**
 * utils/html.js — Escape text before it goes into an HTML email body.
 *
 * The OTP and password-reset emails interpolate a user's own name into HTML. The
 * name is only ever sent to that user's own address, so the exposure is small,
 * but a name containing '<' or '&' would still render wrong (or worse) in a mail
 * client. Escaping it costs nothing and closes the gap.
 */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Replace the five HTML-significant characters with their entities. */
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

module.exports = { escapeHtml };
