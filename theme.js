// Sætter valgt tema før første tegning, så siden ikke blinker.
(function () {
  try {
    var t = localStorage.getItem('obslog-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* lagring utilgængelig – følg systemet */ }
})();
