/* Standalone Embeddable AI Chat & Click-to-Call Voice SDK Proxy Loader */
(function () {
  var current = document.currentScript;
  var apiOrigin = (current && current.getAttribute('data-api-origin')) || 'http://localhost:3001';
  var s = document.createElement('script');
  s.src = apiOrigin + '/api/v1/widget.js';
  if (current) {
    ['data-tenant', 'data-title', 'data-primary-color', 'data-enable-voice'].forEach(function (attr) {
      var val = current.getAttribute(attr);
      if (val) s.setAttribute(attr, val);
    });
  }
  s.async = true;
  document.head.appendChild(s);
})();
