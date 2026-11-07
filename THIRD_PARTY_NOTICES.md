# Third-party notices — dsh-ustc-latex-agent

## olcli (`olcli-ustc`)

`latex-plugin/lib/overleaf-client.js` is a vendored and adapted copy of the
Overleaf client from **olcli-ustc 0.7.0**
(`pkg/package/dist/client.js`), the command-line client for Overleaf by
**Alexander Loth**.

- Upstream project: https://github.com/aloth/olcli
- Upstream package: `olcli-ustc@0.7.0` (`dist/client.js`, 1901 lines)
- License: MIT
- Copyright: Copyright (c) 2026 Alexander Loth

The file was vendored into this project and then adapted for use as the
transport core of the `dsh-ustc-latex-agent` DSH plugin. The original MIT license
text is reproduced below and applies to the vendored portions of the file.

### Modifications made in `lib/overleaf-client.js`

1. **Zero npm dependencies.** Imports of `cheerio`, `node:fs`, `node:path` and
   `node:url` were removed. HTML parsing directly used by the client
   (`extractCsrfToken`, `isLoginPage`, project dashboard parsing, project info
   parsing) is reimplemented with small raw-HTML helpers. The `package.json`
   version lookup was replaced with a static `USER_AGENT`
   (`dsh-ustc-latex-agent/0.1.0`). The downstream `adm-zip` fallback in
   `downloadByPath()` was replaced with a minimal in-memory ZIP reader built on
   `node:zlib` (`inflateRawSync`).
2. **Added high-level document API** for live co-editing: `readDoc()`,
   `setDocumentText()`, `replaceText()`, plus the pure helpers
   `encodeOverleafUtf8` / `decodeOverleafUtf8`, `buildReplaceOp`,
   `applyShareJsTextOp` and `parseProjectId`. The write path joins the
   collaboration socket for the freshest `{lines, version}`, builds a ShareJS
   text op, validates it locally, sends `applyOtUpdate`, and retries on
   version/stale errors by re-joining.
3. **Document type safety.** Direct writes to `history-ot` documents are
   rejected with a clear error instead of guessing an op shape.
4. **UTF-8 handling.** Document lines are decoded from Overleaf's
   byte-per-character ("binary string") representation for humans, and
   `d`/`i` op payloads are encoded back into that representation. A round-trip
   check refuses to send an op if the content does not re-encode byte for byte.
5. Comment/compile/upload/REST behaviour is otherwise kept from olcli, with
   only mechanical adaptations (raw HTML parsing, built-in ZIP extraction).

---

## MIT License (olcli)

```
MIT License

Copyright (c) 2026 Alexander Loth

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```


## Distribution license

The combined work is distributed under **GPL-3.0-only** (see `LICENSE`). The MIT-licensed portions
described above remain under their original terms; MIT is compatible with GPLv3, and the upstream
copyright and permission notice are retained here and in the adapted file headers.
