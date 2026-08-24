// SPDX-License-Identifier: AGPL-3.0-only

const brandMark = document.querySelector<HTMLElement>(".brand-mark");
if (brandMark) {
  brandMark.innerHTML = `
    <svg class="brand-logo-svg" viewBox="0 0 64 64" width="39" height="39" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="miniTrail" x1="11" y1="8" x2="54" y2="51" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#3fdfff"/>
          <stop offset=".5" stop-color="#5d7cff"/>
          <stop offset="1" stop-color="#a64dff"/>
        </linearGradient>
        <radialGradient id="miniBg" cx="50%" cy="35%" r="78%">
          <stop offset="0" stop-color="#14204a"/>
          <stop offset="1" stop-color="#070a16"/>
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#miniBg)" stroke="#5870c8" stroke-opacity=".7"/>
      <g fill="none" stroke="url(#miniTrail)" stroke-linecap="round">
        <path d="M14 43 A22 22 0 1 1 50 43" stroke-width="2.7"/>
        <path d="M18 41 A18 18 0 1 1 46 41" stroke-width="2.1" opacity=".86"/>
        <path d="M22 39 A14 14 0 1 1 42 39" stroke-width="1.5" opacity=".72"/>
      </g>
      <path d="M32 18 L33.5 28.5 L44 30 L33.5 31.5 L32 42 L30.5 31.5 L20 30 L30.5 28.5 Z" fill="#f4fbff"/>
      <path d="M7 53 L17 45 L23 49 L32 40 L40 49 L47 45 L57 53 L57 59 L7 59 Z" fill="#050817"/>
    </svg>`;
}

const footerVersion = document.querySelector<HTMLElement>(".footer > span");
if (footerVersion) {
  footerVersion.textContent = "GUI4tihulu-star-trail · AGPL-3.0-only · v0.3.1";
}
