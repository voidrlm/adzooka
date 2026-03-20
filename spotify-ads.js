// Adzooka — Spotify Ad Skipper (MAIN world, document_start)
// Hooks WebSocket + fetch to intercept Spotify's state machine and remove ad tracks.
// Core logic ported from the open-source wsHook + Blockify ads_removal approach.
(function () {
  'use strict';
  if (!location.hostname.includes('spotify.com')) return;

  // ── 1. wsHook — WebSocket interception ──────────────────────────────────────
  var wsHook = {};

  (function () {
    var before = wsHook.before = function (data, url) {
      return Promise.resolve(data);
    };
    var after = wsHook.after = function (e, url) {
      return Promise.resolve(e);
    };
    wsHook.resetHooks = function () {
      wsHook.before = before;
      wsHook.after  = after;
    };

    var _WS = WebSocket;
    WebSocket = function (url, protocols) {
      var WSObject = protocols ? new _WS(url, protocols) : new _WS(url);
      this.url       = url;
      this.protocols = protocols;

      var _send = WSObject.send;
      WSObject.send = function (data) {
        wsHook.before(data, WSObject.url).then(function (newData) {
          if (newData != null) _send.apply(WSObject, [newData]);
        }).catch(function () {
          _send.apply(WSObject, [data]);
        });
      };

      var onmessageFunction;
      WSObject.__defineSetter__('onmessage', function (fn) {
        onmessageFunction = fn;
      });
      WSObject.addEventListener('message', function (event) {
        if (!onmessageFunction) return;
        wsHook.after(new MutableMessageEvent(event), WSObject.url).then(function (modified) {
          if (modified != null) onmessageFunction.apply(this, [modified]);
        }).catch(function () {
          onmessageFunction.apply(this, [event]);
        });
      });

      return WSObject;
    };
  })();

  function MutableMessageEvent(o) {
    this.bubbles        = o.bubbles        || false;
    this.cancelBubble   = o.cancelBubble   || false;
    this.cancelable     = o.cancelable     || false;
    this.currentTarget  = o.currentTarget  || null;
    this.data           = o.data           || null;
    this.defaultPrevented = o.defaultPrevented || false;
    this.eventPhase     = o.eventPhase     || 0;
    this.lastEventId    = o.lastEventId    || '';
    this.origin         = o.origin         || '';
    this.path           = o.path           || [];
    this.ports          = o.ports          || [];
    this.returnValue    = o.returnValue    || true;
    this.source         = o.source         || null;
    this.srcElement     = o.srcElement     || null;
    this.target         = o.target         || null;
    this.timeStamp      = o.timeStamp      || null;
    this.type           = o.type           || 'message';
    this.__proto__      = o.__proto__      || MessageEvent.__proto__;
  }

  // ── 2. Ad removal — state machine manipulation ───────────────────────────────
  var originalFetch       = window.fetch;
  var accessToken         = '';
  var deviceId            = '';
  var tamperedStatesIds   = [];
  var isSimulatingStateChange = false;

  async function getAccessToken() {
    try {
      var res  = await originalFetch.call(window,
        'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
        { credentials: 'same-origin' }
      );
      var json = await res.json();
      accessToken = json['accessToken'] || '';
    } catch (_) {}
  }

  // Hook fetch — intercept /state responses
  window.fetch = function (url, init) {
    if (url != null && typeof url === 'string' && url.includes('/state')) {
      return originalFetch.call(window, url, init).then(function (response) {
        return interceptStateResponse(init, response);
      });
    }
    if (url != null && typeof url === 'string' && url.endsWith('/devices') && init && init.body) {
      try {
        var req = JSON.parse(init.body);
        if (req.device && req.device.device_id) deviceId = req.device.device_id;
      } catch (_) {}
    }
    return originalFetch.call(window, url, init);
  };

  function interceptStateResponse(init, response) {
    var origJson = response.json.bind(response);
    response.json = function () {
      return origJson().then(async function (data) {
        var stateMachine   = data['state_machine'];
        var updatedStateRef = data['updated_state_ref'];
        if (!stateMachine || updatedStateRef == null) return data;
        data['state_machine'] = await manipulateStateMachine(stateMachine, updatedStateRef['state_index'], false);
        return data;
      }).catch(async function (err) {
        var msg = String(err);
        if (msg.includes('No token provided') || msg.includes('Token expired')) {
          await getAccessToken();
        }
      });
    };
    return response;
  }

  // Hook WebSocket — intercept replace_state payloads
  wsHook.after = function (messageEvent, url) {
    return new Promise(async function (resolve) {
      try {
        var data = JSON.parse(messageEvent.data);
        if (!data.payloads) { resolve(messageEvent); return; }

        for (var i = 0; i < data.payloads.length; i++) {
          var payload = data.payloads[i];
          if (payload.type === 'replace_state') {
            var stateRef = payload['state_ref'];
            if (stateRef != null) {
              payload['state_machine'] = await manipulateStateMachine(
                payload['state_machine'], stateRef['state_index'], true
              );
              data.payloads[i] = payload;
            }
            if (isSimulatingStateChange) {
              resolve(new MutableMessageEvent({ ...messageEvent, data: '{}' }));
              return;
            }
          }
        }

        messageEvent.data = JSON.stringify(data);
      } catch (_) {}
      resolve(messageEvent);
    });
  };

  // ── State machine manipulation ───────────────────────────────────────────────
  async function manipulateStateMachine(stateMachine, startingStateIndex, isReplacingState) {
    var states = stateMachine['states'];
    var tracks = stateMachine['tracks'];
    var removedAds;

    do {
      removedAds = false;
      for (var i = 0; i < states.length; i++) {
        var state   = states[i];
        var stateId = state['state_id'];
        var track   = tracks[state['track']];

        if (!isAd(state, stateMachine)) {
          if (i === startingStateIndex && !isReplacingState && tamperedStatesIds.includes(stateId)) {
            console.log('[Adzooka] Spotify ad removed');
            document.body && document.body.setAttribute('_adzooka_ad_removed', performance.now());
          }
          continue;
        }

        console.log('[Adzooka] Spotify ad detected:', track['metadata']['uri']);

        var nextState = getNextState(stateMachine, track, i);

        if (nextState && isAd(nextState, stateMachine)) {
          // Multiple consecutive ads — request future states from Spotify
          try {
            var maxAttempts    = 3;
            var j              = 0;
            var futureStateMachine = stateMachine;

            do {
              var latestTrack = futureStateMachine['tracks'][nextState['track']];
              futureStateMachine = await getStates(futureStateMachine['state_machine_id'], nextState['state_id']);
              nextState = getNextState(futureStateMachine, latestTrack);
              j++;
            } while (isAd(nextState, futureStateMachine) && j < maxAttempts);

            var nextStateId = nextState['state_id'];
            nextState['state_id']     = stateId;
            nextState['transitions']  = {};
            var nextTrack = futureStateMachine['tracks'][nextState['track']];
            tracks.push(nextTrack);
            nextState['track'] = tracks.length - 1;

            if (i === startingStateIndex && !isReplacingState) {
              nextState['state_id']               = nextStateId;
              stateMachine['state_machine_id']    = futureStateMachine['state_machine_id'];
            }
          } catch (err) {
            var msg = String(err);
            if (msg.includes('Token expired') || msg.includes('No token provided')) {
              await getAccessToken();
              i--;
              continue;
            }
            // Fallback: shorten the ad to its end so it auto-advances
            state = shortenState(state, track);
          }
          removedAds = true;
        }

        if (nextState != null) {
          state = nextState;
          tamperedStatesIds.push(nextState['state_id']);
          removedAds = true;
        }

        states[i] = state;
      }
    } while (removedAds);

    stateMachine['states'] = states;
    stateMachine['tracks'] = tracks;
    return stateMachine;
  }

  function isAd(state, stateMachine) {
    if (!state) return false;
    try {
      var uri = stateMachine['tracks'][state['track']]['metadata']['uri'];
      return uri.includes(':ad:');
    } catch (_) { return false; }
  }

  function shortenState(state, track) {
    var duration = track['metadata']['duration'];
    state['disallow_seeking']         = false;
    state['restrictions']             = {};
    state['initial_playback_position'] = duration;
    state['position_offset']          = duration;
    return state;
  }

  function* statesGenerator(states, startIndex, nextKey) {
    for (var state = states[startIndex]; state != null; ) {
      yield state;
      var transition = state['transitions'] && state['transitions'][nextKey];
      if (!transition) break;
      state = states[transition['state_index']];
    }
  }

  function getNextState(stateMachine, sourceTrack, startIndex) {
    startIndex = startIndex || 2;
    var states  = stateMachine['states'];
    var tracks  = stateMachine['tracks'];
    var found   = false;
    var prev    = null;
    var state;

    for (state of statesGenerator(states, startIndex, 'advance')) {
      var track = tracks[state['track']];
      if (found) {
        if (track['content_type'] === 'AD') continue;
        return state;
      }
      if (prev === state) return state; // cycle guard
      found = track['metadata']['uri'] === sourceTrack['metadata']['uri'];
      prev  = state;
    }
    return state;
  }

  async function getStates(stateMachineId, startingStateId, retries) {
    retries = retries === undefined ? 4 : retries;
    var url  = 'https://spclient.wg.spotify.com/track-playback/v1/devices/' + deviceId + '/state';
    var body = JSON.stringify({
      seq_num:   Date.now(),
      state_ref: { state_machine_id: stateMachineId, state_id: startingStateId, paused: false },
      sub_state: { playback_speed: 1, position: 0, duration: 0, stream_time: 0, media_type: 'AUDIO', bitrate: 160000 },
      previous_position: 0,
      debug_source: 'resume',
    });
    var headers = { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' };

    var res  = await originalFetch.call(window, url, { method: 'PUT', headers, body });
    var json = await res.json();

    if (json['error'] && (json['error']['message'] || '').includes('expired')) {
      await getAccessToken();
      res  = await originalFetch.call(window, url, { method: 'PUT', headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body });
      json = await res.json();
    }

    if (!json['state_machine'] && retries > 0) {
      return getStates(stateMachineId, startingStateId, retries - 1);
    }

    return json['state_machine'];
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
  getAccessToken();
})();
