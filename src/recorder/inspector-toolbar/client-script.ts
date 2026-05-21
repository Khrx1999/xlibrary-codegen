/**
 * Client-side JS for the Inspector toolbar.
 *
 * Runs INSIDE the Playwright Inspector window (not Node), so it uses ES5-ish
 * syntax + `var` to keep compatibility with whatever Chromium version
 * Playwright is bundling without depending on Babel.
 *
 * Responsibilities:
 *   - Open a WebSocket to viewer-server (port baked into VIEWER_URL).
 *   - Render replay-state updates (`{type:'replay-state', state}`) into the
 *     badge pill + progress text.
 *   - Forward button clicks back as `{type:'replay-start' | 'replay-pause' | …}`.
 *   - Reconnect on close after a 2-second delay.
 *
 * The `viewerUrl` is interpolated as a JSON literal so any embedded quotes
 * are safely escaped.
 */

export function buildClientScript(viewerUrl: string): string {
  // JSON.stringify guarantees safe escaping of the URL inside the JS string.
  const safeUrl = JSON.stringify(viewerUrl);

  return `<script>
(function(){
  var VIEWER_URL = ${safeUrl};
  var WS_URL = VIEWER_URL.replace(/^http/, 'ws');
  var B = {
    replay: document.getElementById('xlib-replay'),
    pause:  document.getElementById('xlib-pause'),
    resume: document.getElementById('xlib-resume'),
    step:   document.getElementById('xlib-step'),
    stop:   document.getElementById('xlib-stop'),
  };
  var badge = document.getElementById('xlib-badge');
  var progress = document.getElementById('xlib-progress');
  var openViewer = document.getElementById('xlib-open-viewer');
  var ws = null;

  // Update only the visible text node, leaving the leading ::before dot alone.
  function setBadge(state){
    badge.className = state;
    badge.textContent = state;
  }
  function applyState(s){
    setBadge(s.status);
    var idx = s.currentIndex >= 0 ? s.currentIndex + 1 : 0;
    progress.textContent = (s.currentName ? s.currentName + ' • ' : '') + idx + ' / ' + (s.totalActions || 0);
    var st = s.status;
    B.replay.disabled = !(st === 'idle' || st === 'complete' || st === 'stopped' || st === 'error');
    B.pause.disabled  = st !== 'running';
    B.resume.disabled = st !== 'paused';
    B.step.disabled   = st !== 'paused' && st !== 'running';
    B.stop.disabled   = st !== 'running' && st !== 'paused';
  }
  function send(cmd){
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: cmd }));
  }
  B.replay.addEventListener('click', function(){ send('replay-start');  });
  B.pause .addEventListener('click', function(){ send('replay-pause');  });
  B.resume.addEventListener('click', function(){ send('replay-resume'); });
  B.step  .addEventListener('click', function(){ send('replay-step');   });
  B.stop  .addEventListener('click', function(){ send('replay-stop');   });
  openViewer.addEventListener('click', function(){
    window.open(VIEWER_URL, '_blank', 'noopener');
  });

  function connect(){
    try { ws = new WebSocket(WS_URL); }
    catch (e) { setBadge('offline'); return; }
    ws.onopen = function(){
      setBadge('idle');
      B.replay.disabled = false;
    };
    ws.onmessage = function(evt){
      try {
        var m = JSON.parse(evt.data);
        if (m.type === 'replay-state' && m.state) applyState(m.state);
      } catch (_) {}
    };
    ws.onclose = function(){
      setBadge('offline');
      setTimeout(connect, 2000);
    };
    ws.onerror = function(){ /* onclose will fire next — let it reconnect */ };
  }
  connect();
})();
</script>`;
}
