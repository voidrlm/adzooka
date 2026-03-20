// Adzooka — Background Service Worker
// Ad blocking is handled entirely by:
//   - rules/ad_block_rules.json  (static DNR rules for Spotify)
//   - content.js                 (YouTube DOM + skip-button handler)
//   - scriptlets.js              (YouTube ytInitialPlayerResponse intercept)
// No dynamic rules, filter lists, or storage needed.
