// Starts Blazor with DOM preservation disabled (enhanced navigation off, streaming replaces content wholesale).
// Lives in a file because a strict CSP forbids the inline <script>Blazor.start(...)</script> the docs show.
Blazor.start({ ssr: { disableDomPreservation: true } });
