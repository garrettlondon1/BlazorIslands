# BlazorIslands compatibility matrix

Generated 2026-10-06T23:42:03.827Z · overall: failed

Each cell asserts: island mounted exactly once (handed over, not re-mounted, when an interactive renderer re-renders
prerendered DOM), props from the final renderer, page script ran exactly once with its DOM changes visible,
island ↔ .NET events and props, .NET → JS interop, teardown on leave, `BlazorIslands.inspect()` clean, zero CSP
violations and zero uncaught errors.

| page · arrival | enhanced | enhanced-aspnetcore-main | enhanced-firefox | enhanced-net11 | enhanced-strict-dynamic | enhanced-webkit | global-auto | global-server | global-wasm | no-dom-preservation | no-enhanced-nav |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| auto · back and forward | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| auto · full load | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| auto · navigate away | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| auto · navigate in | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| auto · reload | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| auto · round trip | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| auto · same page again | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| auto-np · back and forward | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| auto-np · full load | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| auto-np · navigate away | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| auto-np · navigate in | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| auto-np · reload | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| auto-np · round trip | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| auto-np · same page again | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| inherit · back and forward | · | · | · | · | · | · | ✅ | ✅ | ✅ | · | · |
| inherit · early click (before the router is interactive) | · | · | · | · | · | · | ✅ | ✅ | ✅ | · | · |
| inherit · full load | · | · | · | · | · | · | ✅ | ✅ | ✅ | · | · |
| inherit · navigate away | · | · | · | · | · | · | ✅ | ✅ | ✅ | · | · |
| inherit · navigate in | · | · | · | · | · | · | ✅ | ✅ | ✅ | · | · |
| inherit · reload | · | · | · | · | · | · | ✅ | ✅ | ✅ | · | · |
| inherit · round trip | · | · | · | · | · | · | ✅ | ✅ | ✅ | · | · |
| inherit · same page again | · | · | · | · | · | · | ✅ | ✅ | ✅ | · | · |
| inherit · websocket drop and reconnect | · | · | · | · | · | · | · | ✅ | · | · | · |
| server · back and forward | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server · full load | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server · navigate away | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server · navigate in | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server · reload | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server · round trip | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server · same page again | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server · websocket drop and reconnect | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server-np · back and forward | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server-np · full load | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server-np · navigate away | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server-np · navigate in | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server-np · reload | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server-np · round trip | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server-np · same page again | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| server-np · websocket drop and reconnect | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| static · back and forward | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| static · full load | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| static · navigate away | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| static · navigate in | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| static · reload | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| static · round trip | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| static · same page again | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| stream · back and forward | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| stream · full load | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| stream · navigate away | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| stream · navigate in | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| stream · reload | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| stream · round trip | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| stream · same page again | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm · back and forward | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm · full load | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm · navigate away | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm · navigate in | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm · reload | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm · round trip | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm · same page again | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm-np · back and forward | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm-np · full load | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm-np · navigate away | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm-np · navigate in | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm-np · reload | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm-np · round trip | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
| wasm-np · same page again | ✅ | · | ✅ | ✅ | ✅ | ✅ | · | · | · | ✅ | ✅ |
