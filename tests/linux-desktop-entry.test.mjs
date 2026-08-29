import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const install = readFileSync(new URL("../scripts/install.sh", import.meta.url), "utf8");

test("Linux installer shows one Studio entry while preserving its app-id aliases", () => {
  assert.match(install, /WAYLAND_APP_ID="gui4tihulu-star-trail"/);
  assert.match(install, /COSMIC_APP_ID="Gui4tihulu-star-trail"/);
  assert.ok(install.includes('for APP_ID in "$WAYLAND_APP_ID" "$COSMIC_APP_ID"; do'));
  assert.ok(install.includes('if [ "$APP_ID" = "$WAYLAND_APP_ID" ]; then'));
  assert.ok(install.includes("printf 'NoDisplay=true\\n' >> \"$DESKTOP_FILE\""));
});

test("Studio install never removes the separately installed legacy Tihulu Star Trail launcher", () => {
  assert.ok(!install.includes('rm -f "$HOME/.local/share/applications/tihulu-star-trail.desktop"'));
});
