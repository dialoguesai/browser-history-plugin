# Safari packaging and attachment

The automatic local-agent handoff has been exercised in Safari 27.0.1 on macOS
using a temporary extension. It requires ordinary website access, but does not
require an agent to fill in its identity or use Chromium-only APIs.

## Callback fix is independent of Apple signing

Safari `runtime.id` is a bundle identifier. Its `runtime.getURL('options.html')`
has a per-install UUID origin, for example:

```text
safari-web-extension://12345678-1234-1234-1234-123456789ABC/options.html
```

The plugin registers that exact callback (case preserved) using:

```json
{
  "browser": "safari",
  "extension_id": "12345678-1234-1234-1234-123456789abc",
  "redirect_uri": "safari-web-extension://12345678-1234-1234-1234-123456789ABC/options.html"
}
```

POST to `/v1/apps/browser-history-plugin/extension-install/redirects`. The
control-plane candidate validates the same UUID origin and exact options path;
other hosts, queries, fragments and paths are refused. Existing public-PKCE,
registration-key, rate and install-count checks still apply. Chrome registration
is unchanged. Safari then uses the normal browser-tab Grant Access flow and
checks OAuth state before exchange. Its options callback is web-accessible only
from `https://cp.logu3s.com`; a custom control-plane deployment must add its exact
origin to that manifest entry. The callback rejects missing or mismatched state
before exchanging a code.

The deployed server must include this patch before Safari can attach. Signing
the app does not register callbacks or preserve new fields in an older node.
The plugin can be tested with its local receipt verifier before server deployment.

## Build a signed macOS app

Apple's converter generates an app containing the Safari extension:

```sh
xcrun safari-web-extension-converter /absolute/extension-folder \
  --project-location /absolute/output-folder \
  --app-name 'Dialogues Browser History' \
  --bundle-identifier ai.dialogues.browserhistory \
  --macos-only --copy-resources --no-open --no-prompt
```

Check the generated app bundle identifier is `ai.dialogues.browserhistory` and
the extension is `ai.dialogues.browserhistory.Extension`; some converter versions
regenerate the app identifier from the display name. Keep their versions aligned
with `manifest.json`. The toolbar uses OffscreenCanvas, so the candidate's minimum
macOS deployment target is 13.3; actual compatibility is validated only on the
Safari release listed in the support matrix.

Use the organization's existing signing identity and team in Xcode's Signing &
Capabilities. The converter warns about `identity`, `tabGroups`, `notifications`
and background `type`. The automatic Safari handoff does not depend on identity
or tab-group APIs; registration uses its own options callback. Notification and
other optional paths still need separate Safari acceptance.

For distribution outside the Mac App Store, use Developer ID signing, hardened
runtime and notarization. A locally signed build is not automatically notarized
or accepted for distribution. A signed package and the temporary development
extension are separate installs; test the signed package's own permissions,
callback registration and normal owner grant before calling it released.

Callback navigation: [WebExtensions web-accessible resources](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/web_accessible_resources).

Sources: [Apple: creating a Safari web extension](https://developer.apple.com/documentation/safariservices/creating-a-safari-web-extension),
[Apple: distributing a Safari web extension](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension).
