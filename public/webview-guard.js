// ES5-проверка до загрузки модулей: если WebView старый, показываем понятный экран,
// даже когда современный бандл не может выполниться. Вынесено из index.html,
// чтобы CSP могла запретить inline-скрипты.
(function () {
  var match = /Chrome\/(\d+)/.exec(navigator.userAgent || '');
  var old = match && Number(match[1]) < 98;
  var missing = false;
  try {
    missing = !window.indexedDB || typeof Promise === 'undefined' ||
      typeof URL.createObjectURL !== 'function' || !('flatMap' in Array.prototype);
  } catch (error) { missing = true; }
  if (old || missing) document.getElementById('webview-warning').hidden = false;
  var button = document.getElementById('webview-continue');
  if (button) button.addEventListener('click', function () {
    document.getElementById('webview-warning').hidden = true;
  });
})();
