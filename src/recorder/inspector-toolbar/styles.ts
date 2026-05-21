/**
 * CSS for the Inspector toolbar.
 *
 * Design notes:
 *   - Light, professional theme to blend with Playwright Inspector's paper background.
 *   - Status pill uses a `::before` coloured dot keyed off the badge's class name
 *     (`.running`, `.paused`, `.complete`, `.error`, `.stopped`, `.idle`, `.offline`).
 *   - The `.running` dot pulses via a 1.2s ease-in-out animation.
 */

export const STYLES = `<style>
  #xlib-bar, #xlib-bar *{box-sizing:border-box;}
  #xlib-bar{
    position:fixed;bottom:0;left:0;right:0;z-index:99999;
    background:#ffffff;border-top:1px solid #e5e7eb;color:#111827;
    padding:8px 14px;
    font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","Inter",system-ui,sans-serif;
    display:flex;gap:6px;align-items:center;
    box-shadow:0 -4px 16px rgba(15,23,42,.06);
  }
  .xlib-btn{
    display:inline-flex;align-items:center;gap:6px;
    background:#ffffff;color:#374151;
    border:1px solid #e5e7eb;
    padding:6px 11px;border-radius:6px;
    font:500 12.5px/1 inherit;cursor:pointer;
    transition:background .12s ease,border-color .12s ease,color .12s ease,box-shadow .12s ease,opacity .12s ease;
  }
  .xlib-btn:hover:not(:disabled){
    background:#f9fafb;border-color:#d1d5db;
    box-shadow:0 1px 2px rgba(15,23,42,.04);
  }
  .xlib-btn:active:not(:disabled){background:#f3f4f6;}
  .xlib-btn:disabled{opacity:.4;cursor:not-allowed;}
  .xlib-btn.primary{
    background:#0f766e;border-color:#0f766e;color:#ffffff;
  }
  .xlib-btn.primary:hover:not(:disabled){
    background:#115e59;border-color:#115e59;
  }
  .xlib-btn.danger{
    background:#ffffff;color:#b91c1c;border-color:#fecaca;
  }
  .xlib-btn.danger:hover:not(:disabled){
    background:#fef2f2;border-color:#fca5a5;color:#991b1b;
  }
  .xlib-btn.ghost{
    border-color:transparent;color:#6b7280;
  }
  .xlib-btn.ghost:hover:not(:disabled){
    color:#111827;border-color:#e5e7eb;background:#f9fafb;
  }
  #xlib-progress{
    font-size:12px;color:#6b7280;margin-left:auto;
    font-variant-numeric:tabular-nums;
    font-family:"SF Mono","Cascadia Code","JetBrains Mono",Consolas,monospace;
  }
  #xlib-badge{
    display:inline-flex;align-items:center;gap:6px;
    padding:4px 11px 4px 9px;border-radius:9999px;
    background:#f3f4f6;color:#374151;
    font-size:11px;font-weight:600;letter-spacing:.01em;
  }
  #xlib-badge::before{
    content:'';width:6px;height:6px;border-radius:50%;
    background:#9ca3af;flex-shrink:0;
  }
  #xlib-badge.running::before {background:#3b82f6;}
  #xlib-badge.running         {background:#eff6ff;color:#1d4ed8;}
  #xlib-badge.paused::before  {background:#d97706;}
  #xlib-badge.paused          {background:#fffbeb;color:#92400e;}
  #xlib-badge.complete::before{background:#059669;}
  #xlib-badge.complete        {background:#ecfdf5;color:#047857;}
  #xlib-badge.error::before   {background:#dc2626;}
  #xlib-badge.error           {background:#fef2f2;color:#b91c1c;}
  #xlib-badge.stopped::before {background:#6b7280;}
  #xlib-badge.stopped         {background:#f9fafb;color:#4b5563;}
  #xlib-badge.idle::before    {background:#9ca3af;}
  #xlib-badge.offline         {background:#fef2f2;color:#9f1239;}
  #xlib-badge.offline::before {background:#e11d48;}
  /* Animate the running dot to convey activity. */
  #xlib-badge.running::before{
    animation:xlib-pulse 1.2s ease-in-out infinite;
  }
  @keyframes xlib-pulse{
    0%,100%{opacity:1;transform:scale(1);}
    50%{opacity:.5;transform:scale(.85);}
  }
</style>`;
