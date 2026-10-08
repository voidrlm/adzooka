# Adzooka

Load this directory as an unpacked extension from `chrome://extensions` (Developer mode).
After updating extension files, reload the extension and refresh existing website tabs.

## Element picker

Open Adzooka on an enabled website and choose **Pick element to block**. Click an element
for a preview, adjust with **Parent / Child** or the arrow keys, then press **Block element**
or Enter. **Undo** removes the last saved rule (up to 50 picks in the current session).
**Move panel** switches the toolbar between the top and bottom edges. Escape cancels a
selection; Escape again or **Done** closes the picker.

Rules affect the current hostname and take effect immediately. Removing a rule or pausing
the site restores elements without a reload. Nested open shadow roots are supported;
closed shadow roots and cross-origin frames are selected as whole containers. Structural
fallback rules may need to be picked again if a site changes its layout.

**Block scripted popups** controls `window.open` on all enabled sites, including frames.
It blocks scripted new tabs/windows (including scripted sign-in windows); normal links and
same-window navigation remain available. Turn it off when a site needs a scripted window.
Settings apply live after extension storage is read. This does not remove in-page dialogs.

## Checks

Node.js 22+ and Chrome are required; no npm dependencies are needed:

```sh
node --test tests/*.test.mjs
```

Set `CHROME_PATH` if Chrome is not at `/usr/bin/google-chrome`. Browser tests use a disposable
headless Chrome profile and mocked extension APIs to exercise real DOM, hit testing,
keyboard/pointer input, shadow roots, popup settings, and cleanup. Background tests cover
concurrent saves and failure handling. These are not a substitute for testing the loaded
extension on the sites you use.
