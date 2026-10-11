/* ByeBoer — file writers that work fully offline (no libraries, no internet).
 *   FX.xlsx(sheets)  -> Blob  (Excel workbook, several sheets)
 *   new FX.PDF(opts) -> simple A4 report writer, .blob() -> Blob
 *   FX.ics(opts)     -> Blob  (daily calendar reminder)
 */
(function () {
  'use strict';

  /* ================================================================ */
  /* ZIP (store only) — used by the Excel writer                       */
  /* ================================================================ */
  var CRC_T = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipStore(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f[0]), data = enc.encode(f[1]), crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (s, p) { return s + p.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
    var all = parts.concat(central, [new Uint8Array(end.buffer)]);
    var total = all.reduce(function (s, p) { return s + p.length; }, 0), out = new Uint8Array(total), pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  /* ================================================================ */
  /* Excel (.xlsx)                                                     */
  /* ================================================================ */
  // sheet = { name, cols:[{h, w, f}], rows:[ [..] | {c:[..], b:bool, sec:bool} ], sumCols:[idx], totalLabel, plain:bool }
  // f: text | wrap | date | money | int | num1 | num2
  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function colName(i) {
    var s = '';
    i++;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function excelDate(s) {
    var p = String(s || '').split('-');
    if (p.length !== 3) return null;
    return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30)) / 86400000);
  }
  function sheetName(s, used) {
    var n = String(s).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31) || 'Sheet';
    var base = n, i = 2;
    while (used[n.toLowerCase()]) n = base.slice(0, 28) + ' ' + (i++);
    used[n.toLowerCase()] = 1;
    return n;
  }

  // style ids
  var ST = { head: 1, date: 2, money: 3, int: 4, num1: 5, num2: 6, text: 7, wrap: 8, bold: 9, boldMoney: 10,
             sec: 11, totLabel: 12, totMoney: 13, totNum: 14, totNum1: 15, totNum2: 16, boldInt: 17, boldNum1: 18, boldNum2: 19 };
  var NUMFMT = { date: 164, money: 165, int: 3, num1: 166, num2: 4 };

  function cellStyle(f, bold) {
    if (bold) return { money: ST.boldMoney, int: ST.boldInt, num1: ST.boldNum1, num2: ST.boldNum2 }[f] || ST.bold;
    return { date: ST.date, money: ST.money, int: ST.int, num1: ST.num1, num2: ST.num2, wrap: ST.wrap }[f] || ST.text;
  }
  function totStyle(f) { return { money: ST.totMoney, int: ST.totNum, num1: ST.totNum1, num2: ST.totNum2 }[f] || ST.totNum2; }

  function buildSheet(sh) {
    var cols = sh.cols, n = cols.length, rows = [], r = 1;
    function str(ref, v, st) { return '<c r="' + ref + '" t="inlineStr" s="' + st + '"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>'; }
    function num(ref, v, st) { return (v == null || v === '' || isNaN(v)) ? '' : '<c r="' + ref + '" s="' + st + '"><v>' + Number(v) + '</v></c>'; }

    if (!sh.plain) {
      rows.push('<row r="1" ht="30" customHeight="1">' + cols.map(function (c, i) { return str(colName(i) + '1', c.h, ST.head); }).join('') + '</row>');
      r = 2;
    }
    var first = r;
    (sh.rows || []).forEach(function (row) {
      var cells = Array.isArray(row) ? row : row.c, bold = !Array.isArray(row) && row.b, sec = !Array.isArray(row) && row.sec;
      var x = '<row r="' + r + '"' + (sec ? ' ht="22" customHeight="1"' : '') + '>';
      cells.forEach(function (v, i) {
        var f = (cols[i] && cols[i].f) || 'text';
        if (v && typeof v === 'object') { f = v.f || f; v = v.v; }   // per-cell format: {v, f}
        if (v == null || v === '') return;
        var ref = colName(i) + r;
        if (sec) { x += str(ref, v, ST.sec); return; }
        if (typeof v === 'number' || f === 'date') {
          if (f === 'date') { var d = excelDate(v); x += d == null ? str(ref, v, ST.text) : num(ref, d, ST.date); }
          else x += num(ref, v, cellStyle(f === 'text' || f === 'wrap' ? 'num2' : f, bold));
        } else x += str(ref, v, cellStyle(f, bold));
      });
      rows.push(x + '</row>');
      r++;
    });
    var last = r - 1;
    if (sh.sumCols && sh.sumCols.length) {
      var tr = r + 1, labelCol = Math.max(0, Math.min.apply(null, sh.sumCols) - 1);
      var x = '<row r="' + tr + '">' + str(colName(labelCol) + tr, sh.totalLabel || 'Total', ST.totLabel);
      sh.sumCols.forEach(function (ci) {
        var cn = colName(ci), tot = 0;
        (sh.rows || []).forEach(function (row) {
          var v = (Array.isArray(row) ? row : row.c)[ci];
          if (v && typeof v === 'object') v = v.v;
          if (typeof v === 'number') tot += v;
        });
        x += '<c r="' + cn + tr + '" s="' + totStyle(cols[ci].f) + '"><f>SUM(' + cn + first + ':' + cn + Math.max(first, last) + ')</f><v>' + Math.round(tot * 100) / 100 + '</v></c>';
      });
      rows.push(x + '</row>');
      r = tr + 1;
    }
    var lastCol = colName(n - 1), dimRow = Math.max(1, r - 1);
    var hasData = !sh.plain && (sh.rows || []).length > 0;
    return {
      xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
        '<dimension ref="A1:' + lastCol + dimRow + '"/>' +
        '<sheetViews>' + (sh.plain ? '<sheetView workbookViewId="0"/>'
          : '<sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>') + '</sheetViews>' +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        '<cols>' + cols.map(function (c, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.w || 14) + '" customWidth="1"/>'; }).join('') + '</cols>' +
        '<sheetData>' + rows.join('') + '</sheetData>' +
        (hasData ? '<autoFilter ref="A1:' + lastCol + last + '"/>' : '') +
        '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
        '<pageSetup paperSize="9" orientation="' + (n > 6 ? 'landscape' : 'portrait') + '" fitToWidth="1" fitToHeight="0"/>' +
        '</worksheet>',
      filter: hasData ? 'A1:' + lastCol + last : null
    };
  }

  function xlsx(sheets) {
    var used = {}, built = sheets.map(function (s) { var b = buildSheet(s); b.name = sheetName(s.name, used); return b; });
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="&quot;R &quot;#,##0.00;[Red]&quot;-R &quot;#,##0.00"/><numFmt numFmtId="166" formatCode="#,##0.0"/></numFmts>' +
      '<fonts count="4"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="13"/><color rgb="FF8F5300"/><name val="Calibri"/><family val="2"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF8F5300"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="20">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                                     // 0
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' + // 1 head
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>' + // 2 date
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>' +   // 3 money
        '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>' +     // 4 int
        '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>' +   // 5 num1
        '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>' +     // 6 num2
        '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>' +    // 7 text
        '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // 8 wrap
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                                       // 9 bold
        '<xf numFmtId="165" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +                               // 10 bold money
        '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="bottom"/></xf>' +   // 11 section
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +                                       // 12 total label
        '<xf numFmtId="165" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +               // 13 total money
        '<xf numFmtId="3" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +                 // 14 total int
        '<xf numFmtId="166" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +               // 15 total num1
        '<xf numFmtId="4" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +                 // 16 total num2
        '<xf numFmtId="3" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +                                 // 17 bold int
        '<xf numFmtId="166" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +                               // 18 bold num1
        '<xf numFmtId="4" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +                                 // 19 bold num2
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';

    var files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        built.map(function (b, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' + built.map(function (b, i) { return '<sheet name="' + xmlEsc(b.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets>' +
        (built.some(function (b) { return b.filter; }) ? '<definedNames>' + built.map(function (b, i) {
          if (!b.filter) return '';
          var abs = b.filter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
          return '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + xmlEsc(b.name.replace(/'/g, "''")) + '\'!' + abs + '</definedName>';
        }).join('') + '</definedNames>' : '') +
        '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
        '</workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        built.map(function (b, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
        '<Relationship Id="rId' + (built.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>'],
      ['xl/styles.xml', styles]
    ];
    built.forEach(function (b, i) { files.push(['xl/worksheets/sheet' + (i + 1) + '.xml', b.xml]); });
    return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ================================================================ */
  /* PDF (A4, built-in Helvetica fonts)                               */
  /* ================================================================ */
  var W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  var W_REG_HI = [278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
  var W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  var W_BOLD_HI = [278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
  // Unicode -> WinAnsi (0x80-0x9F) and their widths
  var WIN = { 0x20AC: [0x80, 556], 0x201A: [0x82, 222], 0x0192: [0x83, 556], 0x201E: [0x84, 333], 0x2026: [0x85, 1000], 0x2020: [0x86, 556],
    0x2021: [0x87, 556], 0x02C6: [0x88, 333], 0x2030: [0x89, 1000], 0x0160: [0x8A, 667], 0x2039: [0x8B, 333], 0x0152: [0x8C, 1000],
    0x017D: [0x8E, 611], 0x2018: [0x91, 222], 0x2019: [0x92, 222], 0x201C: [0x93, 333], 0x201D: [0x94, 333], 0x2022: [0x95, 350],
    0x2013: [0x96, 556], 0x2014: [0x97, 1000], 0x02DC: [0x98, 333], 0x2122: [0x99, 1000], 0x0161: [0x9A, 500], 0x203A: [0x9B, 333],
    0x0153: [0x9C, 944], 0x017E: [0x9E, 500], 0x0178: [0x9F, 667] };
  var SUBST = { 0x202F: ' ', 0x2009: ' ', 0x2007: ' ', 0x2212: '-', 0x2192: '->', 0x2264: '<=', 0x2265: '>=', 0x00AD: '' };

  // Convert a JS string to a WinAnsi "byte string" (each char code < 256)
  function winAnsi(s) {
    var out = '';
    s = String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ');
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (SUBST[c] != null) { out += SUBST[c]; continue; }
      if (c >= 0xD800 && c <= 0xDBFF) { i++; out += '?'; continue; } // emoji etc.
      if (c < 32) continue;
      if (c < 128 || (c >= 160 && c < 256)) out += String.fromCharCode(c);
      else if (WIN[c]) out += String.fromCharCode(WIN[c][0]);
      else out += '?';
    }
    return out;
  }
  var WIN_W = {};
  Object.keys(WIN).forEach(function (k) { WIN_W[WIN[k][0]] = WIN[k][1]; });
  function charW(code, bold) {
    if (code >= 32 && code < 127) return (bold ? W_BOLD : W_REG)[code - 32];
    if (code >= 160 && code < 256) return (bold ? W_BOLD_HI : W_REG_HI)[code - 160];
    return WIN_W[code] || 556;
  }
  function textW(bs, size, bold) {   // bs = WinAnsi byte string
    var w = 0;
    for (var i = 0; i < bs.length; i++) w += charW(bs.charCodeAt(i), bold);
    return w * size / 1000;
  }
  function pdfStr(bs) { return '(' + bs.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')'; }
  function f2(n) { return (Math.round(n * 100) / 100).toString(); }
  function fit(bs, w, size, bold) {
    if (textW(bs, size, bold) <= w) return bs;
    var ell = '\x85';
    while (bs.length && textW(bs + ell, size, bold) > w) bs = bs.slice(0, -1);
    return bs.replace(/\s+$/, '') + ell;
  }
  function wrap(bs, w, size, bold) {
    var words = bs.split(' '), lines = [], cur = '';
    words.forEach(function (word) {
      var tryLine = cur ? cur + ' ' + word : word;
      if (textW(tryLine, size, bold) <= w) { cur = tryLine; return; }
      if (cur) lines.push(cur);
      // very long word: hard-break
      while (textW(word, size, bold) > w && word.length > 1) {
        var k = word.length;
        while (k > 1 && textW(word.slice(0, k), size, bold) > w) k--;
        lines.push(word.slice(0, k)); word = word.slice(k);
      }
      cur = word;
    });
    if (cur || !lines.length) lines.push(cur);
    return lines;
  }

  var GREEN = [0.56, 0.33, 0.0], INK = [0.08, 0.09, 0.11], MUTED = [0.39, 0.42, 0.47], ZEBRA = [0.98, 0.96, 0.91], LINE = [0.85, 0.87, 0.85];

  function PDF(opts) {
    opts = opts || {};
    this.W = 595.28; this.H = 841.89; this.M = 40;
    this.pages = []; this.footer = opts.footer || '';
    this.pageLabel = opts.pageLabel || 'Page';
    this.images = [];
    this.newPage();
  }
  PDF.prototype.newPage = function () {
    this.cur = []; this.pages.push(this.cur); this.y = this.M;
  };
  PDF.prototype.ensure = function (h) { if (this.y + h > this.H - this.M - 18) { this.newPage(); return true; } return false; };
  PDF.prototype.color = function (c, stroke) { this.cur.push(c.map(f2).join(' ') + (stroke ? ' RG' : ' rg')); };
  PDF.prototype.text = function (x, y, s, size, bold, color, align, maxW) {
    var bs = winAnsi(s);
    if (maxW) bs = fit(bs, maxW, size, bold);
    var w = textW(bs, size, bold);
    if (align === 'r') x -= w; else if (align === 'c') x -= w / 2;
    this.color(color || INK);
    this.cur.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + f2(size) + ' Tf ' + f2(x) + ' ' + f2(this.H - y) + ' Td ' + pdfStr(bs) + ' Tj ET');
    return w;
  };
  PDF.prototype.rect = function (x, y, w, h, c) {
    this.color(c); this.cur.push(f2(x) + ' ' + f2(this.H - y - h) + ' ' + f2(w) + ' ' + f2(h) + ' re f');
  };
  PDF.prototype.hline = function (x1, x2, y, c, lw) {
    this.color(c || LINE, true);
    this.cur.push(f2(lw || 0.6) + ' w ' + f2(x1) + ' ' + f2(this.H - y) + ' m ' + f2(x2) + ' ' + f2(this.H - y) + ' l S');
  };

  // JPEG image (data URL) drawn at x, y (top-left) with width w and height h, in points
  PDF.prototype.image = function (dataUrl, pxW, pxH, x, y, w, h) {
    var m = /^data:image\/jpeg;base64,(.*)$/.exec(dataUrl || '');
    if (!m) return false;
    var name = 'Im' + this.images.length;
    this.images.push({ name: name, bin: atob(m[1]), w: pxW, h: pxH });
    this.cur.push('q ' + f2(w) + ' 0 0 ' + f2(h) + ' ' + f2(x) + ' ' + f2(this.H - y - h) + ' cm /' + name + ' Do Q');
    return true;
  };

  /* Layout helpers ----------------------------------------------------- */
  PDF.prototype.title = function (t, sub) {
    this.text(this.M, this.y + 20, t, 20, true, GREEN);
    this.y += 30;
    if (sub) { var self = this; [].concat(sub).forEach(function (s) { self.text(self.M, self.y + 11, s, 10, false, MUTED); self.y += 14; }); }
    this.y += 6;
    this.hline(this.M, this.W - this.M, this.y, GREEN, 1.2);
    this.y += 14;
  };
  PDF.prototype.heading = function (t) {
    this.ensure(48);
    this.y += 6;
    this.text(this.M, this.y + 12, t, 13, true, GREEN);
    this.y += 20;
  };
  PDF.prototype.note = function (t) {
    var self = this, lines = wrap(winAnsi(t), this.W - 2 * this.M, 9, false);
    lines.forEach(function (l) {
      self.ensure(12);
      self.cur.push('');
      self.color(MUTED);
      self.cur.push('BT /F1 9 Tf ' + f2(self.M) + ' ' + f2(self.H - self.y - 9) + ' Td ' + pdfStr(l) + ' Tj ET');
      self.y += 12;
    });
    this.y += 4;
  };
  // Key/value block: rows = [[label, value, bold?], ...]
  PDF.prototype.kv = function (rows, labelW) {
    var self = this, x2 = this.M + (labelW || 260);
    rows.forEach(function (r) {
      self.ensure(16);
      self.text(self.M, self.y + 11, r[0], 10, !!r[2], r[2] ? INK : MUTED, 'l', x2 - self.M - 10);
      self.text(x2, self.y + 11, r[1], 10, !!r[2], INK, 'r');
      self.y += 16;
    });
    this.y += 6;
  };
  // Table: cols = [{h, w, a:'l'|'r', wrap:bool}], rows = [[..]], opts.total = [..] (bold last row)
  PDF.prototype.table = function (cols, rows, opts) {
    opts = opts || {};
    var self = this, size = opts.size || 8.5, lh = size + 3.5, pad = 4;
    var totalW = this.W - 2 * this.M, fixed = 0, flex = 0;
    cols.forEach(function (c) { if (c.w) fixed += c.w; else flex++; });
    var xs = [], x = this.M;
    cols.forEach(function (c) { var w = c.w || (totalW - fixed) / Math.max(1, flex); xs.push([x, w]); x += w; });

    function header() {
      self.rect(self.M, self.y, totalW, lh + 6, GREEN);
      cols.forEach(function (c, i) {
        var cx = c.a === 'r' ? xs[i][0] + xs[i][1] - pad : xs[i][0] + pad;
        self.text(cx, self.y + lh + 1, c.h, size, true, [1, 1, 1], c.a === 'r' ? 'r' : 'l', xs[i][1] - 2 * pad);
      });
      self.y += lh + 6;
    }
    this.ensure(lh * 3 + 10);
    header();
    var all = rows.slice();
    if (opts.total) all.push({ total: opts.total });
    if (!rows.length && opts.empty) {
      this.text(this.M + pad, this.y + lh, opts.empty, size, false, MUTED);
      this.y += lh + 6;
    }
    all.forEach(function (row, ri) {
      var isTot = !!row.total, cells = isTot ? row.total : row;
      var wrapped = cols.map(function (c, i) {
        var bs = winAnsi(cells[i]);
        return c.wrap ? wrap(bs, xs[i][1] - 2 * pad, size, isTot) : [bs];
      });
      var nLines = Math.max.apply(null, wrapped.map(function (l) { return l.length; }));
      var h = nLines * lh + 4;
      if (self.ensure(h)) header();
      if (isTot) self.hline(self.M, self.M + totalW, self.y, INK, 0.8);
      else if (ri % 2 === 1) self.rect(self.M, self.y, totalW, h, ZEBRA);
      cols.forEach(function (c, i) {
        wrapped[i].forEach(function (line, li) {
          var bs = c.wrap ? line : fit(line, xs[i][1] - 2 * pad, size, isTot);
          var tw = textW(bs, size, isTot);
          var cx = c.a === 'r' ? xs[i][0] + xs[i][1] - pad - tw : xs[i][0] + pad;
          self.color(INK);
          self.cur.push('BT /' + (isTot ? 'F2' : 'F1') + ' ' + f2(size) + ' Tf ' + f2(cx) + ' ' + f2(self.H - (self.y + 2 + (li + 1) * lh - 2.5)) + ' Td ' + pdfStr(bs) + ' Tj ET');
        });
      });
      self.y += h;
    });
    this.y += 12;
  };
  // Simple horizontal bar chart: items = [[label, value, valueText]]
  PDF.prototype.bars = function (items, opts) {
    opts = opts || {};
    var self = this, max = 0, labelW = opts.labelW || 70, valW = 70, bh = 11, gap = 4;
    items.forEach(function (it) { if (it[1] > max) max = it[1]; });
    var barMax = this.W - 2 * this.M - labelW - valW - 10;
    items.forEach(function (it) {
      self.ensure(bh + gap);
      self.text(self.M, self.y + 9, it[0], 8.5, false, MUTED, 'l', labelW - 6);
      var w = max > 0 ? Math.max(it[1] > 0 ? 1.5 : 0, barMax * it[1] / max) : 0;
      if (w) self.rect(self.M + labelW, self.y + 1, w, bh - 2, opts.color || [0.35, 0.6, 0.85]);
      self.text(self.W - self.M, self.y + 9, it[2], 8.5, false, INK, 'r');
      self.y += bh + gap;
    });
    this.y += 8;
  };

  PDF.prototype.blob = function () {
    var self = this, objs = [], n = this.pages.length;
    // footers
    this.pages.forEach(function (p, i) {
      var save = self.cur; self.cur = p;
      self.hline(self.M, self.W - self.M, self.H - self.M + 2, LINE, 0.6);
      if (self.footer) self.text(self.M, self.H - self.M + 14, self.footer, 8, false, MUTED, 'l', 380);
      self.text(self.W - self.M, self.H - self.M + 14, self.pageLabel + ' ' + (i + 1) + ' / ' + n, 8, false, MUTED, 'r');
      self.cur = save;
    });
    // objects: 1 catalog, 2 pages, 3 F1, 4 F2, then page/content pairs
    var kids = [];
    for (var i = 0; i < n; i++) kids.push((5 + i * 2) + ' 0 R');
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    var xo = '', imgBase = 5 + n * 2;
    this.images.forEach(function (im, j) {
      var oid = imgBase + j;
      xo += '/' + im.name + ' ' + oid + ' 0 R ';
      objs[oid] = '<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
        im.bin.length + ' >>\nstream\n' + im.bin + '\nendstream';
    });
    this.pages.forEach(function (p, i) {
      var pid = 5 + i * 2, cid = pid + 1, stream = p.filter(Boolean).join('\n');
      objs[pid] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f2(self.W) + ' ' + f2(self.H) + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>' +
        (xo ? ' /XObject << ' + xo + '>>' : '') + ' >> /Contents ' + cid + ' 0 R >>';
      objs[cid] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream';
    });
    var out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', offs = [];
    for (var k = 1; k < objs.length; k++) {
      offs[k] = out.length;
      out += k + ' 0 obj\n' + objs[k] + '\nendobj\n';
    }
    var xref = out.length;
    out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
    for (k = 1; k < objs.length; k++) out += ('0000000000' + offs[k]).slice(-10) + ' 00000 n \n';
    out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    var bytes = new Uint8Array(out.length);
    for (k = 0; k < out.length; k++) bytes[k] = out.charCodeAt(k) & 0xFF;
    return new Blob([bytes], { type: 'application/pdf' });
  };

  /* ================================================================ */
  /* Calendar reminder (.ics)                                          */
  /* ================================================================ */
  function icsEsc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function ics(o) {   // o: { time:'18:00', title, desc, url }
    var now = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    var hm = String(o.time || '18:00').split(':');
    var start = now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) + 'T' + p(+hm[0]) + p(+hm[1] || 0) + '00';
    var stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ByeBoer//Diary reminder//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VTIMEZONE', 'TZID:Africa/Johannesburg', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0200', 'TZNAME:SAST', 'END:STANDARD', 'END:VTIMEZONE',
      'BEGIN:VEVENT', 'UID:byeboer-diary-' + stamp + '@byeboer', 'DTSTAMP:' + stamp,
      'DTSTART;TZID=Africa/Johannesburg:' + start, 'DURATION:PT10M', 'RRULE:FREQ=DAILY',
      'SUMMARY:' + icsEsc(o.title), 'DESCRIPTION:' + icsEsc(o.desc + (o.url ? '\n' + o.url : '')),
      (o.url ? 'URL:' + o.url : ''),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc(o.title), 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].filter(Boolean);
    return new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar' });
  }

  PDF.ACCENT = GREEN; PDF.MUTED = MUTED; PDF.INK = INK; PDF.LINE = LINE; PDF.ZEBRA = ZEBRA;
  PDF.textW = function (s, size, bold) { return textW(winAnsi(s), size, bold); };
  PDF.wrap = function (s, w, size, bold) { return wrap(winAnsi(s), w, size, bold); };
  window.FX = { xlsx: xlsx, PDF: PDF, ics: ics };
})();
