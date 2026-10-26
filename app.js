/* Markdown Table — spreadsheet-like editor, CSV/TSV/Markdown import, aligned Markdown output. All local. */
(function () {
  "use strict";
  var $ = S3.$, h = S3.h;
  var ALIGNS = ["none", "left", "center", "right"];
  var ALIGN_LABEL = { none: "---", left: ":--", center: ":-:", right: "--:" };

  // ---------- core ----------
  // shortcut: width counts code points, so CJK/emoji columns may look off by a little in monospace; fine for Markdown renderers.
  function width(s) { return Array.from(s).length; }
  function escCell(s) { return String(s == null ? "" : s).replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|").trim(); }
  function pad(s, w, align) {
    var gap = w - width(s);
    if (gap <= 0) return s;
    if (align === "right") return " ".repeat(gap) + s;
    if (align === "center") { var l = Math.floor(gap / 2); return " ".repeat(l) + s + " ".repeat(gap - l); }
    return s + " ".repeat(gap);
  }
  function sepCell(w, align) {
    if (align === "left") return ":" + "-".repeat(w - 1);
    if (align === "right") return "-".repeat(w - 1) + ":";
    if (align === "center") return ":" + "-".repeat(w - 2) + ":";
    return "-".repeat(w);
  }
  function toMarkdown(rows, aligns, pretty) {
    if (!rows.length) return "";
    var cols = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var cells = rows.map(function (r) { var o = []; for (var c = 0; c < cols; c++) o.push(escCell(r[c])); return o; });
    var w = [];
    for (var c = 0; c < cols; c++) w[c] = pretty ? Math.max(3, Math.max.apply(null, cells.map(function (r) { return width(r[c]); }))) : 3;
    function line(r) { return "| " + r.map(function (s, c) { return pretty ? pad(s, w[c], aligns[c]) : s; }).join(" | ") + " |"; }
    var out = [line(cells[0]), "| " + w.map(function (x, c) { return sepCell(x, aligns[c]); }).join(" | ") + " |"];
    for (var i = 1; i < cells.length; i++) out.push(line(cells[i]));
    return out.join("\n");
  }

  function splitMdRow(line) {
    var s = line.trim();
    if (s[0] === "|") s = s.slice(1);
    if (s.slice(-1) === "|" && s.slice(-2) !== "\\|") s = s.slice(0, -1);
    var out = [], cur = "";
    for (var i = 0; i < s.length; i++) {
      if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
      else if (s[i] === "|") { out.push(cur.trim()); cur = ""; }
      else cur += s[i];
    }
    out.push(cur.trim());
    return out.map(function (c) { return c.replace(/<br\s*\/?>/gi, "\n"); });
  }
  var SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
  function parseMarkdown(text) {
    var lines = String(text).split(/\r?\n/).filter(function (l) { return l.trim(); });
    var si = -1;
    for (var i = 1; i < lines.length; i++) if (SEP_RE.test(lines[i]) && lines[i].indexOf("-") >= 0) { si = i; break; }
    if (si !== 1) return null;
    var aligns = splitMdRow(lines[1]).map(function (c) {
      var l = c[0] === ":", r = c.slice(-1) === ":";
      return l && r ? "center" : r ? "right" : l ? "left" : "none";
    });
    var rows = [splitMdRow(lines[0])].concat(lines.slice(2).map(splitMdRow));
    return { rows: rows, aligns: aligns };
  }
  function detectDelim(text) {
    var first = String(text).split(/\r?\n/)[0] || "";
    if (first.indexOf("\t") >= 0) return "\t";
    var bare = first.replace(/"[^"]*"/g, "");
    return (bare.split(";").length > bare.split(",").length) ? ";" : ",";
  }
  function parseCSV(text, delim) {
    var rows = [], row = [], cur = "", q = false, s = String(text);
    delim = delim || detectDelim(s);
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) {
        if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"' && cur === "") q = true;
      else if (ch === delim) { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && s[i + 1] === "\n") i++;
        row.push(cur); rows.push(row); row = []; cur = "";
      } else cur += ch;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function parseAny(text) {
    var md = parseMarkdown(text);
    if (md) return md;
    var rows = parseCSV(text);
    return { rows: rows, aligns: [] };
  }
  function normalize(rows, aligns) {
    var cols = Math.max(1, Math.max.apply(null, rows.map(function (r) { return r.length; }).concat([0])));
    rows = rows.map(function (r) { var o = r.slice(); while (o.length < cols) o.push(""); return o; });
    if (!rows.length) rows = [new Array(cols).fill("")];
    var a = []; for (var c = 0; c < cols; c++) a.push(aligns[c] || "none");
    return { rows: rows, aligns: a };
  }

  // ---------- state + UI ----------
  var saved = S3.store("mdt.table");
  var state = saved && saved.rows && saved.rows.length ? normalize(saved.rows, saved.aligns || []) : blank();
  var grid = $("#grid"), out = $("#out");
  $("#pretty").checked = S3.store("mdt.pretty") !== false;

  function blank() { return normalize([["Column 1", "Column 2", "Column 3"], ["", "", ""], ["", "", ""]], []); }
  function cols() { return state.rows[0].length; }

  function build() {
    grid.textContent = "";
    var ctl = h("tr", { "class": "ctl" }, [h("th", { "aria-hidden": "true" })]);
    for (var c = 0; c < cols(); c++) {
      ctl.appendChild(h("th", null, [h("div", { "class": "colctl" }, [
        h("button", { "class": "align", "data-col": c, title: "Alignment: " + state.aligns[c] + " (click to change)", "aria-label": "Column " + (c + 1) + " alignment: " + state.aligns[c], text: ALIGN_LABEL[state.aligns[c]] }),
        h("button", { "class": "x", "data-delcol": c, title: "Delete column", "aria-label": "Delete column " + (c + 1), text: "×", disabled: cols() < 2 })
      ])]));
    }
    ctl.appendChild(h("th"));
    var thead = h("thead", null, [ctl]), tbody = h("tbody");
    state.rows.forEach(function (row, r) {
      var tr = h("tr", { "class": r === 0 ? "head" : "" }, [h("td", { "class": "idx", text: r === 0 ? "H" : String(r) })]);
      row.forEach(function (val, c) {
        var inp = h("input", { "class": "cell", "data-r": r, "data-c": c, dir: "auto", spellcheck: "false",
          "aria-label": (r === 0 ? "Header" : "Row " + r) + ", column " + (c + 1), style: "text-align:" + (state.aligns[c] === "none" ? "start" : state.aligns[c]) });
        inp.value = val;
        tr.appendChild(h("td", null, [inp]));
      });
      tr.appendChild(h("td", { "class": "rowx" }, [r === 0 ? null : h("button", { "class": "x", "data-delrow": r, title: "Delete row", "aria-label": "Delete row " + r, text: "×" })]));
      tbody.appendChild(tr);
    });
    grid.appendChild(thead); grid.appendChild(tbody);
    update();
  }
  function update() {
    var md = toMarkdown(state.rows, state.aligns, $("#pretty").checked);
    out.textContent = md;
    $("#dims").textContent = cols() + " columns × " + (state.rows.length - 1) + " rows";
    S3.store("mdt.table", state);
  }
  function focusCell(r, c) { var el = grid.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]'); if (el) { el.focus(); el.select(); } }

  function setTable(t, firstIsHeader) {
    var rows = t.rows;
    if (!firstIsHeader) rows = [rows[0].map(function (_, i) { return "Column " + (i + 1); })].concat(rows);
    state = normalize(rows, t.aligns || []); build();
  }

  grid.addEventListener("input", function (e) {
    var t = e.target; if (!t.classList.contains("cell")) return;
    state.rows[+t.dataset.r][+t.dataset.c] = t.value; update();
  });
  grid.addEventListener("keydown", function (e) {
    var t = e.target; if (!t.classList.contains("cell") || e.key !== "Enter") return;
    e.preventDefault();
    var r = +t.dataset.r + (e.shiftKey ? -1 : 1), c = +t.dataset.c;
    if (r >= state.rows.length) { state.rows.push(new Array(cols()).fill("")); build(); }
    focusCell(Math.max(0, r), c);
  });
  grid.addEventListener("paste", function (e) {
    var t = e.target; if (!t.classList.contains("cell")) return;
    var text = (e.clipboardData || window.clipboardData).getData("text");
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return; // single value: normal paste
    e.preventDefault();
    var md = parseMarkdown(text);
    if (md) { setTable(md, true); S3.toast("Markdown table imported"); return; }
    var block = parseCSV(text.replace(/\r?\n$/, ""), text.indexOf("\t") >= 0 ? "\t" : "\u0000");
    var r0 = +t.dataset.r, c0 = +t.dataset.c;
    block.forEach(function (row, i) {
      while (state.rows.length <= r0 + i) state.rows.push(new Array(cols()).fill(""));
      row.forEach(function (v, j) {
        while (cols() <= c0 + j) { state.rows.forEach(function (rr, k) { rr.push(k === 0 ? "Column " + (rr.length + 1) : ""); }); state.aligns.push("none"); }
        state.rows[r0 + i][c0 + j] = v;
      });
    });
    build(); focusCell(r0, c0);
    S3.toast("Pasted " + block.length + " × " + Math.max.apply(null, block.map(function (r) { return r.length; })) + " cells");
  });
  grid.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.col != null) { var c = +b.dataset.col; state.aligns[c] = ALIGNS[(ALIGNS.indexOf(state.aligns[c]) + 1) % 4]; build(); }
    else if (b.dataset.delcol != null && cols() > 1) { var dc = +b.dataset.delcol; state.rows.forEach(function (r) { r.splice(dc, 1); }); state.aligns.splice(dc, 1); build(); }
    else if (b.dataset.delrow != null) { state.rows.splice(+b.dataset.delrow, 1); build(); }
  });

  $("#add-row").addEventListener("click", function () { state.rows.push(new Array(cols()).fill("")); build(); focusCell(state.rows.length - 1, 0); });
  $("#add-col").addEventListener("click", function () {
    state.rows.forEach(function (r, i) { r.push(i === 0 ? "Column " + (r.length + 1) : ""); }); state.aligns.push("none"); build(); focusCell(0, cols() - 1);
  });
  $("#clear").addEventListener("click", function () { state = blank(); build(); });
  $("#pretty").addEventListener("change", function (e) { S3.store("mdt.pretty", e.target.checked); update(); });
  $("#toggle-import").addEventListener("click", function () {
    var box = $("#import"), open = box.hidden; box.hidden = !open; this.setAttribute("aria-expanded", String(open)); if (open) $("#import-text").focus();
  });
  $("#do-import").addEventListener("click", function () {
    var text = $("#import-text").value;
    if (!text.trim()) { S3.toast("Paste something to import first", "error"); return; }
    var t = parseAny(text);
    var isMd = !!parseMarkdown(text);
    setTable(t, isMd || $("#first-header").checked);
    $("#import").hidden = true; $("#toggle-import").setAttribute("aria-expanded", "false");
    S3.toast("Imported " + (isMd ? "Markdown" : detectDelim(text) === "\t" ? "TSV" : "CSV") + ": " + cols() + " × " + (state.rows.length - 1)); S3.done();
  });
  $("#sample").addEventListener("click", function () {
    setTable({ rows: [["Tool", "Category", "Runs offline", "Price"], ["JSON Studio", "Developer", "Yes", "$0"], ["Chmod Calc", "Developer", "Yes", "$0"],
      ["Contrast Check", "Design", "Yes", "$0"], ["Markdown Table", "Developer", "Yes", "$0"]], aligns: ["left", "none", "center", "right"] }, true);
  });
  $("#copy").addEventListener("click", function () { S3.copy(out.textContent, "Markdown copied"); S3.done(); });
  $("#save").addEventListener("click", function () { S3.download(out.textContent + "\n", "table.md", "text/markdown"); S3.done(); });

  build();

  window.S3_DEMO = function () { $("#sample").click(); };

  window.S3_SELFTEST = function () {
    var md = toMarkdown([["Name", "Qty"], ["Apple", "3"]], ["left", "right"], true);
    var c = toMarkdown([["a", "b"], ["x", "y"]], ["center", "none"], false);
    var esc = toMarkdown([["h"], ["a|b"]], [], true);
    var back = parseMarkdown(md), escBack = parseMarkdown(esc);
    var csv = parseCSV('a,"b,c"\n"d ""q""",e');
    var semi = parseCSV("x;y\n1;2");
    var tsv = parseAny("n\tv\r\n1\t2\r\n");
    var ctr = toMarkdown([["Title"], ["x"]], ["center"], true);
    return md === "| Name  | Qty |\n| :---- | --: |\n| Apple |   3 |" &&
      c === "| a | b |\n| :-: | --- |\n| x | y |" &&
      esc === "| h    |\n| ---- |\n| a\\|b |" && escBack.rows[1][0] === "a|b" &&
      ctr === "| Title |\n| :---: |\n|   x   |" &&
      back.aligns.join() === "left,right" && JSON.stringify(back.rows) === '[["Name","Qty"],["Apple","3"]]' &&
      JSON.stringify(csv) === '[["a","b,c"],["d \\"q\\"","e"]]' &&
      JSON.stringify(semi) === '[["x","y"],["1","2"]]' &&
      JSON.stringify(tsv.rows) === '[["n","v"],["1","2"]]' &&
      parseMarkdown("just text\nmore") === null &&
      escCell("line1\nline2") === "line1<br>line2";
  };
})();
