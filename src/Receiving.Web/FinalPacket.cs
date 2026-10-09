// Final packet PDF builder (PdfSharp): cover sheet, original pages, inspection sheets, photos, activity record.
using System.Text.Json.Nodes;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace Receiving.Web;

/// <summary>
/// Builds the final packet PDF: a cover sheet with real (selectable) text for DocuWare indexing,
/// the original BOL/MTR/PO pages, one page set per inspection sheet, and the approval record.
/// </summary>
public static class FinalPacket
{
    const double LetterW = 612, LetterH = 792;
    static FinalPacket() { GlobalFontSettings.UseWindowsFontsUnderWindows = true; }
    static readonly XColor Dark = XColor.FromArgb(33, 59, 52), Med = XColor.FromArgb(0, 99, 37), Light = XColor.FromArgb(161, 206, 173),
        Pale = XColor.FromArgb(217, 232, 226), Gray = XColor.FromArgb(245, 244, 240), Line = XColor.FromArgb(220, 218, 210),
        Ink = XColor.FromArgb(27, 42, 38), Mute = XColor.FromArgb(93, 107, 102), Amber = XColor.FromArgb(161, 92, 0), Red = XColor.FromArgb(161, 38, 38);
    static XFont F(double size, bool bold = false) => new("Arial", size, bold ? XFontStyleEx.Bold : XFontStyleEx.Regular);

    record Sheet(string Key, string Title, string Code, (string key, string label, double w)[] Cols);

    // Columns follow the paper QCF sheets, in sheet order. Heat, Description, NBS # and Coil # are filled from the packet.
    static readonly Sheet[] Sheets =
    [
        new("coil", "Coil Inspection Sheet", "QCF001", [("coil", "Coil #", 1.3), ("heat", "Heat #", 1.2), ("desc", "Description", 2.4), ("cc", "NBS #", 1), ("id", "I.D.", .8), ("od", "O.D.", .8), ("gauge", "Gauge", .9), ("width", "Width", .9), ("color", "Color", 1), ("comments", "Comments", 2.6)]),
        new("sheet", "Flat Sheet Inspection Sheet", "QCF023", [("heat", "Heat #", 1.3), ("desc", "Description", 3), ("cc", "NBS #", 1.1), ("qty", "Qty. Rec./BOL", 1.1), ("len", "Length", 1.1), ("width", "Width", 1.1), ("gauge", "Gauge", 1), ("comments", "Comments", 3.2)]),
        new("bar", "Flat Bar Inspection Sheet", "QCF005", [("heat", "Heat #", 1.2), ("desc", "Description", 2.6), ("cc", "NBS #", 1), ("qty", "Qnty Rec./BOL", 1), ("width", "Width", .9), ("thick", "Thick", .9), ("sweep", "Sweep / Camber", 1.1), ("surface", "Surface", 1), ("comments", "Comments", 2.4), ("cert", "Cert.", .8)]),
        new("shape", "Beam, Channel and Angle Inspection Sheet", "QCF011", [("heat", "Heat #", 1.2), ("desc", "Description", 2.4), ("cc", "NBS #", 1), ("qty", "Qty. Rec./BOL", 1), ("depth", "Depth", .8), ("width", "Width", .8), ("visual", "Visual Insp.", 1), ("thick", "Thickness", .9), ("sweep", "Sweep / Camber", 1.1), ("comments", "Comments", 2.2), ("cert", "Cert.", .8)]),
        new("tube", "Pipe, Rod and Tube Inspection Sheet", "QCF008", [("heat", "Heat #", 1.2), ("desc", "Description", 2.6), ("cc", "NBS #", 1), ("qty", "Qnty Rec./BOL", 1), ("wall", "Wall Thickness", 1.1), ("od", "O.D.", .9), ("surface", "Surface", 1), ("sweep", "Sweep / Camber", 1.1), ("comments", "Comments", 2.4), ("cert", "Cert.", .8)]),
    ];

    static string S(JsonNode? n, string k) => n?[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : (n?[k]?.ToString() ?? "");
    static string When(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("MMM d, yyyy h:mm tt");
    static string Val(string v) => v switch { "ok" => "OK", "bad" => "REJECT", "yes" => "Y", "no" => "N", _ => v };

    static List<string> Wrap(XGraphics g, string text, XFont f, double width)
    {
        var lines = new List<string>();
        foreach (var para in (text ?? "").Replace("\r", "").Split('\n'))
        {
            var cur = "";
            foreach (var word in para.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                var t = cur == "" ? word : cur + " " + word;
                if (g.MeasureString(t, f).Width <= width || cur == "") cur = t;
                else { lines.Add(cur); cur = word; }
            }
            lines.Add(cur);
        }
        return lines;
    }

    static void Text(XGraphics g, string s, XFont f, XColor c, double x, double y, double w = 0, bool right = false)
    {
        var fmt = right ? XStringFormats.TopRight : XStringFormats.TopLeft;
        var rect = right ? new XRect(x - w, y, w, 20) : new XRect(x, y, w <= 0 ? 600 : w, 20);
        g.DrawString(s, f, new XSolidBrush(c), rect, fmt);
    }

    static void Fill(XGraphics g, XColor c, double x, double y, double w, double h) => g.DrawRectangle(new XSolidBrush(c), x, y, w, h);

    sealed class Writer
    {
        public PdfDocument Doc; public PdfPage Page = null!; public XGraphics G = null!; public double Y;
        public double W, H, M;
        public string Footer = "";
        public int Pages;
        public Writer(PdfDocument d) { Doc = d; }
        public void NewPage(bool landscape, double margin)
        {
            G?.Dispose();
            Page = Doc.AddPage(); Page.Width = XUnit.FromPoint(landscape ? LetterH : LetterW); Page.Height = XUnit.FromPoint(landscape ? LetterW : LetterH);
            W = landscape ? LetterH : LetterW; H = landscape ? LetterW : LetterH; M = margin; Y = margin;
            G = XGraphics.FromPdfPage(Page); Pages++;
        }
        public void Close() { G?.Dispose(); }
    }

    /// <summary>Joins several PDFs into one, in the order given.</summary>
    public static byte[] Merge(IEnumerable<Stream> files)
    {
        var doc = new PdfDocument();
        foreach (var f in files)
        {
            using var src = PdfReader.Open(f, PdfDocumentOpenMode.Import);
            foreach (var pg in src.Pages) doc.AddPage(pg);
        }
        using var ms = new MemoryStream(); doc.Save(ms, false); return ms.ToArray();
    }

    /// <summary>Returns the packet PDF for the given packet data. originalPdf and photosDir are optional.</summary>
    public static byte[] Build(string bol, string stage, JsonObject d, string? originalPdf, string siteName, string? photosDir = null)
    {
        var doc = new PdfDocument();
        var rows = d["rows"]!.AsArray().Select(r => r!.AsObject()).ToList();
        var pos = rows.Select(r => S(r, "po")).Where(x => x != "").Distinct().ToList();
        var forms = d["forms"] is JsonObject fo ? fo : new JsonObject();
        var filed = stage == "filed";
        var heats = rows.Select(r => S(r, "heat")).Where(x => x != "").Distinct().ToList();
        var ccs = rows.Select(r => S(r, "cc")).Where(x => x != "").ToList();

        var inspections = new List<(string po, Sheet sheet, JsonObject form)>();
        foreach (var po in pos)
            foreach (var sh in Sheets)
                if (forms[po + "|" + sh.Key] is JsonObject f && f["submitted"]?.GetValue<bool>() == true) inspections.Add((po, sh, f));

        // ---------------- cover sheet ----------------
        var w = new Writer(doc);
        void CoverPage(bool first)
        {
            w.NewPage(false, 40);
            Fill(w.G, Dark, 0, 0, w.W, first ? 74 : 46);
            Text(w.G, first ? "RECEIVING COVER SHEET" : "RECEIVING COVER SHEET (continued)", F(first ? 20 : 12, true), XColor.FromArgb(255, 255, 255), 40, first ? 16 : 14);
            if (first) Text(w.G, siteName + "  |  Nucor Building Systems Texas", F(9), Light, 40, 48);
            Text(w.G, "BOL " + bol, F(first ? 20 : 12, true), XColor.FromArgb(255, 255, 255), w.W - 40, first ? 16 : 14, 300, true);
            w.Y = first ? 90 : 62;
        }
        void Ensure(double h) { if (w.Y + h > w.H - 52) CoverPage(false); }
        void Heading(string t, string? note = null)
        {
            Ensure(40);
            Text(w.G, t, F(9, true), Med, 40, w.Y);
            if (note != null) Text(w.G, note, F(8), Mute, w.W - 40, w.Y, 400, true);
            w.G.DrawLine(new XPen(Line, 0.75), 40, w.Y + 13, w.W - 40, w.Y + 13);
            w.Y += 18;
        }

        CoverPage(true);
        var status = filed ? "AUTHORIZED AND FILED" : "NOT YET AUTHORIZED (preview)";
        Fill(w.G, filed ? Pale : XColor.FromArgb(253, 241, 216), 40, w.Y, 190, 20);
        Text(w.G, status, F(9, true), filed ? Med : Amber, 48, w.Y + 5);
        w.Y += 28;

        Heading("DOCUWARE INDEX FIELDS", "Typed text, not a scan, so DocuWare can read these with click-to-index");
        var approvals = d["approvals"] is JsonArray ap ? ap.Select(a => a!.AsObject()).ToList() : new List<JsonObject>();
        var inspectors = inspections.Select(i => S(i.form, "inspector")).Where(x => x != "").Distinct().ToList();
        var fields = new List<(string k, string v)>
        {
            ("Document type", "Steel Receiving Packet"), ("BOL #", bol), ("Vendor", S(d, "vendor")), ("Ship date", S(d, "ship")),
            ("Carrier", S(d, "carrier")), ("PO #", string.Join(", ", pos)), ("D365 receipt #", S(d, "d365")),
            ("Authorized by", S(d, "authBy")), ("Authorized on", d["authAt"] is JsonNode an && long.TryParse(an.ToString(), out var at) ? When(at) : ""),
            ("Inspected by", string.Join(", ", inspectors)),
        };
        var colW = (w.W - 80) / 2.0;
        for (int i = 0; i < fields.Count; i += 2)
        {
            Ensure(36);
            for (int c = 0; c < 2 && i + c < fields.Count; c++)
            {
                var (k, v) = fields[i + c]; var x = 40 + c * colW;
                Text(w.G, k.ToUpperInvariant(), F(7), Mute, x, w.Y);
                Text(w.G, string.IsNullOrEmpty(v) ? "-" : v, F(11, true), Ink, x, w.Y + 10, colW - 10);
            }
            w.Y += 29;
        }
        foreach (var (k, list) in new[] { ("Heat #", string.Join(", ", heats)), ("NBS # (CC #)", string.Join(", ", ccs)) })
        {
            var lines = Wrap(w.G, list == "" ? "-" : list, F(10, true), w.W - 80);
            Ensure(14 + lines.Count * 13);
            Text(w.G, k.ToUpperInvariant(), F(7), Mute, 40, w.Y);
            var ly = w.Y + 10;
            foreach (var ln in lines) { Text(w.G, ln, F(10, true), Ink, 40, ly); ly += 13; }
            w.Y = ly + 8;
        }

        // items table
        Heading("ITEMS ON THIS PACKET", rows.Count + " line" + (rows.Count == 1 ? "" : "s"));
        var itemCols = new (string h, string k, double w)[] { ("PO #", "po", 78), ("Heat #", "heat", 66), ("Mill coil / bundle #", "coil", 82), ("CC #", "cc", 52), ("Description", "desc", 148), ("Length", "len", 56), ("Weight", "wt", 50) };
        void TableHead((string h, string k, double w)[] cols, double x0, double fontSize)
        {
            Ensure(30);
            var tw = cols.Sum(c => c.w); Fill(w.G, Dark, x0, w.Y, tw, 18);
            var x = x0; foreach (var c in cols) { Text(w.G, c.h, F(fontSize, true), XColor.FromArgb(255, 255, 255), x + 4, w.Y + 5, c.w - 6); x += c.w; }
            w.Y += 18;
        }
        TableHead(itemCols, 40, 7.5); var odd = false;
        foreach (var r in rows)
        {
            var cellLines = itemCols.Select(c => Wrap(w.G, S(r, c.k), F(8.5), c.w - 8)).ToList();
            var h = Math.Max(1, cellLines.Max(l => l.Count)) * 11 + 4;
            if (w.Y + h > w.H - 52) { CoverPage(false); TableHead(itemCols, 40, 7.5); }
            if (odd) Fill(w.G, Gray, 40, w.Y, itemCols.Sum(c => c.w), h);
            var x = 40.0;
            for (int i = 0; i < itemCols.Length; i++)
            {
                var ly = w.Y + 3; foreach (var ln in cellLines[i]) { Text(w.G, ln, F(8.5, itemCols[i].k == "cc"), Ink, x + 4, ly); ly += 11; }
                x += itemCols[i].w;
            }
            w.Y += h; odd = !odd;
        }
        w.G.DrawLine(new XPen(Line, 0.75), 40, w.Y, 40 + itemCols.Sum(c => c.w), w.Y); w.Y += 10;

        // inspection summary
        Heading("INSPECTIONS", inspections.Count + " sheet" + (inspections.Count == 1 ? "" : "s"));
        var inspCols = new (string h, string k, double w)[] { ("PO #", "po", 90), ("Sheet", "sheet", 190), ("Inspector", "ins", 70), ("Date", "date", 72), ("Rows", "rows", 50), ("Rejected", "rej", 60) };
        TableHead(inspCols, 40, 7.5); odd = false;
        foreach (var (po, sh, f) in inspections)
        {
            var items = f["items"] is JsonArray ia ? ia.Select(x => x!.AsObject()).Where(x => x["skip"]?.ToString() != "True" && x["skip"]?.ToString() != "true").ToList() : new List<JsonObject>();
            var rej = items.Count(it => it.Any(kv => kv.Value?.ToString() == "bad"));
            Ensure(18); if (odd) Fill(w.G, Gray, 40, w.Y, inspCols.Sum(c => c.w), 17);
            var vals = new[] { po, sh.Title + " (" + sh.Code + ")", S(f, "inspector"), S(f, "date"), items.Count.ToString(), rej.ToString() };
            var x = 40.0; for (int i = 0; i < vals.Length; i++) { Text(w.G, vals[i], F(8.5, i == 5 && rej > 0), i == 5 && rej > 0 ? Red : Ink, x + 4, w.Y + 4, inspCols[i].w - 6); x += inspCols[i].w; }
            w.Y += 17; odd = !odd;
        }
        if (inspections.Count == 0) { Text(w.G, "No inspections submitted.", F(9), Mute, 44, w.Y + 3); w.Y += 18; }
        w.Y += 6;

        // review and approval
        Heading("REVIEW AND APPROVAL");
        var req = d["requiredReviewers"] is JsonArray ra ? ra.Select(x => x!.AsObject()).ToList() : new List<JsonObject>();
        foreach (var r in req)
        {
            Ensure(16); var a = approvals.FirstOrDefault(x => S(x, "id") == S(r, "id"));
            Text(w.G, S(r, "name"), F(9.5, true), Ink, 44, w.Y);
            Text(w.G, a != null ? "Approved " + When(long.Parse(a["t"]!.ToString())) : "Not approved", F(9), a != null ? Med : Amber, 220, w.Y);
            w.Y += 15;
        }
        if (req.Count == 0) { Text(w.G, "No reviewers were required.", F(9), Mute, 44, w.Y); w.Y += 15; }
        if (S(d, "d365") != "") { Ensure(16); Text(w.G, "Received in D365", F(9.5, true), Ink, 44, w.Y); Text(w.G, "Receipt " + S(d, "d365"), F(9), Ink, 220, w.Y); w.Y += 15; }
        if (filed) { Ensure(16); Text(w.G, "Authorized", F(9.5, true), Ink, 44, w.Y); Text(w.G, S(d, "authBy") + (d["authAt"] != null ? "  " + When(long.Parse(d["authAt"]!.ToString())) : ""), F(9), Ink, 220, w.Y); w.Y += 15; }
        w.Close();

        // page footers on the cover
        for (int i = 0; i < doc.PageCount; i++)
        {
            using var g = XGraphics.FromPdfPage(doc.Pages[i], XGraphicsPdfPageOptions.Append);
            Text(g, $"Generated {DateTime.Now:MMM d, yyyy h:mm tt} by {siteName}", F(7.5), Mute, 40, LetterH - 34);
            Text(g, $"Cover page {i + 1} of {doc.PageCount}", F(7.5), Mute, LetterW - 40, LetterH - 34, 200, true);
        }

        // ---------------- original packet (BOL, MTR, PO) ----------------
        if (originalPdf != null && File.Exists(originalPdf))
        {
            try
            {
                using var src = PdfReader.Open(originalPdf, PdfDocumentOpenMode.Import);
                foreach (var pg in src.Pages) doc.AddPage(pg);
            }
            catch { /* unreadable original: the cover sheet is still produced */ }
        }

        // ---------------- inspection sheets ----------------
        foreach (var (po, sh, f) in inspections)
        {
            var items = f["items"] is JsonArray ia ? ia.Select(x => x!.AsObject()).Where(x => x["skip"]?.ToString() is not ("True" or "true")).ToList() : new List<JsonObject>();
            if (items.Count == 0) items.Add(new JsonObject());
            var iw = new Writer(doc);
            var tableW = LetterH - 72; var sum = sh.Cols.Sum(c => c.w);
            var cols = sh.Cols.Select(c => (c.key, c.label, w: tableW * c.w / sum)).ToArray();
            void Head(bool cont)
            {
                iw.NewPage(true, 36);
                Fill(iw.G, Dark, 0, 0, iw.W, 50);
                Text(iw.G, sh.Title + (cont ? " (continued)" : ""), F(15, true), XColor.FromArgb(255, 255, 255), 36, 10);
                Text(iw.G, "Nucor Building Systems Texas  |  Receiving/Quality Control", F(8.5), Light, 36, 31);
                Text(iw.G, "Form " + sh.Code, F(11, true), XColor.FromArgb(255, 255, 255), iw.W - 36, 14, 200, true);
                var hy = 62.0; var hx = 36.0;
                foreach (var (k, v, wd) in new[] { ("P.O. #", po, 130.0), ("Vendor", S(d, "vendor"), 250.0), ("BOL #", bol, 110.0), ("Inspector", S(f, "inspector"), 90.0), ("Date", S(f, "date"), 90.0) })
                {
                    Text(iw.G, k.ToUpperInvariant(), F(7), Mute, hx, hy); Text(iw.G, v == "" ? "-" : v, F(10.5, true), Ink, hx, hy + 9, wd - 8); hx += wd;
                }
                iw.Y = 96;
                Fill(iw.G, Dark, 36, iw.Y, tableW, 22);
                var x = 36.0; foreach (var c in cols) { Text(iw.G, c.label, F(7.5, true), XColor.FromArgb(255, 255, 255), x + 3, iw.Y + 7, c.w - 4); x += c.w; }
                iw.Y += 22;
            }
            Head(false); var zebra = false;
            foreach (var it in items)
            {
                var cell = cols.Select(c => Wrap(iw.G, Val(S(it, c.key)) + (S(it, c.key) == "bad" && S(it, c.key + "_why") != "" ? " - " + S(it, c.key + "_why") : ""), F(8.5, c.key == "cc"), c.w - 7)).ToList();
                var h = Math.Max(1, cell.Max(l => l.Count)) * 11 + 9;
                if (iw.Y + h > iw.H - 44) { Head(true); zebra = false; }
                if (zebra) Fill(iw.G, Gray, 36, iw.Y, tableW, h);
                var x = 36.0;
                for (int i = 0; i < cols.Length; i++)
                {
                    var bad = S(it, cols[i].key) == "bad"; var ly = iw.Y + 4;
                    foreach (var ln in cell[i]) { Text(iw.G, ln, F(8.5, cols[i].key == "cc" || bad), bad ? Red : Ink, x + 3, ly); ly += 11; }
                    x += cols[i].w;
                }
                iw.G.DrawLine(new XPen(Line, 0.5), 36, iw.Y + h, 36 + tableW, iw.Y + h);
                iw.Y += h; zebra = !zebra;
            }
            Text(iw.G, "Completed in the Steel Receiving app. Inspector: " + S(f, "by") + ".", F(7.5), Mute, 36, iw.H - 30);
            iw.Close();
        }

        // ---------------- photos taken during inspection ----------------
        if (photosDir != null && Directory.Exists(photosDir))
        {
            var shots = new List<(string cap, string path)>();
            foreach (var (po, sh, f) in inspections)
                if (f["items"] is JsonArray pia)
                    foreach (var it in pia.Select(x => x!.AsObject()))
                        if (it["photos"] is JsonArray ph)
                            foreach (var n in ph) { var path = Path.Combine(photosDir, Path.GetFileName(n!.ToString())); if (File.Exists(path)) shots.Add(($"CC {S(it, "cc")}  |  {sh.Title}  |  PO {po}" + (S(it, "comments") != "" ? "  |  " + S(it, "comments") : ""), path)); }
            if (shots.Count > 0)
            {
                var pw = new Writer(doc); bool firstP = true; int col = 0; double rowTop = 0; const double cellW = 252, cellH = 200;
                void PhotoPage()
                {
                    pw.NewPage(false, 40); Fill(pw.G, Dark, 0, 0, pw.W, 46);
                    Text(pw.G, firstP ? "INSPECTION PHOTOS" : "INSPECTION PHOTOS (continued)", F(14, true), XColor.FromArgb(255, 255, 255), 40, 13);
                    Text(pw.G, "BOL " + bol, F(12, true), XColor.FromArgb(255, 255, 255), pw.W - 40, 15, 300, true);
                    pw.Y = 64; firstP = false; col = 0; rowTop = pw.Y;
                }
                PhotoPage();
                foreach (var (cap, path) in shots)
                {
                    if (col == 0) { rowTop = pw.Y; if (rowTop + cellH + 40 > pw.H - 44) { PhotoPage(); } }
                    var x0 = 40 + col * (cellW + 28);
                    try
                    {
                        using var img = XImage.FromFile(path);
                        var sc = Math.Min(cellW / img.PixelWidth, cellH / img.PixelHeight);
                        pw.G.DrawImage(img, x0, rowTop, img.PixelWidth * sc, img.PixelHeight * sc);
                    }
                    catch { Text(pw.G, "(photo could not be read)", F(8), Mute, x0, rowTop); }
                    foreach (var (ln, i) in Wrap(pw.G, cap, F(8), cellW).Take(3).Select((l, i) => (l, i))) Text(pw.G, ln, F(8), Mute, x0, rowTop + cellH + 4 + i * 10);
                    col++; if (col == 2) { col = 0; pw.Y = rowTop + cellH + 44; }
                }
                pw.Close();
            }
        }

        // ---------------- activity record ----------------
        if (d["log"] is JsonArray log && log.Count > 0)
        {
            var lw = new Writer(doc); bool first = true;
            void LogPage()
            {
                lw.NewPage(false, 40); Fill(lw.G, Dark, 0, 0, lw.W, 46);
                Text(lw.G, first ? "ACTIVITY RECORD" : "ACTIVITY RECORD (continued)", F(14, true), XColor.FromArgb(255, 255, 255), 40, 13);
                Text(lw.G, "BOL " + bol, F(12, true), XColor.FromArgb(255, 255, 255), lw.W - 40, 15, 300, true);
                lw.Y = 62; first = false;
            }
            LogPage();
            foreach (var e in log.Select(x => x!.AsObject()))
            {
                var lines = Wrap(lw.G, S(e, "what"), F(9, true), 300);
                var h = Math.Max(1, lines.Count) * 12 + 6;
                if (lw.Y + h > lw.H - 44) LogPage();
                Text(lw.G, When(long.Parse(e["t"]!.ToString())), F(8.5), Mute, 40, lw.Y + 3);
                Text(lw.G, S(e, "who"), F(8.5), Ink, 170, lw.Y + 3, 110);
                var ly = lw.Y + 3; foreach (var ln in lines) { Text(lw.G, ln, F(9, true), Ink, 285, ly); ly += 12; }
                lw.G.DrawLine(new XPen(Line, 0.5), 40, lw.Y + h, lw.W - 40, lw.Y + h);
                lw.Y += h;
            }
            lw.Close();
        }

        doc.Info.Title = $"Receiving packet BOL {bol}";
        doc.Info.Author = siteName;
        doc.Info.Subject = $"Vendor: {S(d, "vendor")}; PO: {string.Join(", ", pos)}; D365: {S(d, "d365")}";
        doc.Info.Keywords = $"BOL {bol}; {string.Join("; ", pos)}; {S(d, "vendor")}";
        using var ms = new MemoryStream(); doc.Save(ms, false);
        return ms.ToArray();
    }
}

