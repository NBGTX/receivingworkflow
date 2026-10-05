using System.Text.Json.Nodes;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;

namespace Receiving.Web;

/// <summary>Stand-in BOL, mill test report and purchase order pages for the built-in demo packets, so their final packet shows the same kind of source pages a real one does.</summary>
internal static class DemoPdf
{
    static DemoPdf() { GlobalFontSettings.UseWindowsFontsUnderWindows = true; }
    static XFont F(double s, bool b = false) => new("Arial", s, b ? XFontStyleEx.Bold : XFontStyleEx.Regular);
    static string S(JsonNode? n, string k) => n?[k]?.ToString() ?? "";
    static readonly XBrush Ink = new XSolidBrush(XColor.FromArgb(40, 40, 40)), Mute = new XSolidBrush(XColor.FromArgb(110, 110, 110));

    static void T(XGraphics g, string s, XFont f, double x, double y, XBrush? b = null) => g.DrawString(s, f, b ?? Ink, new XRect(x, y, 540, 20), XStringFormats.TopLeft);

    static XGraphics Page(PdfDocument d, string title, string sub, string bol)
    {
        var p = d.AddPage(); p.Width = XUnit.FromPoint(612); p.Height = XUnit.FromPoint(792);
        var g = XGraphics.FromPdfPage(p);
        T(g, title, F(16, true), 40, 40); T(g, sub, F(9), 40, 62, Mute); T(g, "BOL " + bol, F(12, true), 440, 42);
        g.DrawLine(new XPen(XColor.FromArgb(60, 60, 60), 1.2), 40, 82, 572, 82);
        T(g, "SAMPLE DOCUMENT generated for the demo. Not a real shipping record.", F(8), 40, 760, Mute);
        return g;
    }

    public static byte[] Build(string bol, string vendor, string ship, string carrier, JsonArray rows)
    {
        var d = new PdfDocument();
        var items = rows.Select(r => r!.AsObject()).ToList();
        var pos = items.Select(r => S(r, "po")).Distinct().ToList();

        // ---- bill of lading ----
        var g = Page(d, "STRAIGHT BILL OF LADING - SHORT FORM", "ORIGINAL - NOT NEGOTIABLE", bol);
        T(g, "FROM:", F(9, true), 40, 96); T(g, vendor, F(11), 90, 94);
        T(g, "SHIP TO:", F(9, true), 40, 120); T(g, "NUCOR BUILDING SYSTEMS, 600 APACHE TRL, TERRELL, TX 75160", F(10), 90, 119);
        T(g, "SHIP DATE:", F(9, true), 40, 144); T(g, ship, F(10), 105, 143);
        T(g, "CARRIER:", F(9, true), 230, 144); T(g, carrier, F(10), 285, 143);
        var x = new[] { 40.0, 125, 190, 270, 375, 440, 500 }; var h = new[] { "PO", "HEAT", "BUNDLE / COIL", "CC #", "DESCRIPTION", "LENGTH", "WEIGHT" };
        double y = 180; g.DrawRectangle(new XSolidBrush(XColor.FromArgb(225, 225, 225)), 40, y - 2, 532, 16);
        for (int i = 0; i < h.Length; i++) T(g, h[i], F(7.5, true), x[i] + 2, y);
        y += 20;
        foreach (var r in items)
        {
            var c = new[] { S(r, "po"), S(r, "heat"), S(r, "coil"), "CC# " + S(r, "cc"), S(r, "desc"), S(r, "len"), S(r, "wt") };
            for (int i = 0; i < c.Length; i++) T(g, c[i].Length > 28 ? c[i][..28] : c[i], F(8.5), x[i] + 2, y);
            y += 16; if (y > 700) break;
        }
        T(g, "Shipper signature: ______________________      Carrier signature: ______________________", F(8), 40, 720, Mute);
        g.Dispose();

        // ---- mill test report ----
        g = Page(d, "CERTIFIED MILL TEST REPORT", "Sample chemical and mechanical results", bol);
        T(g, "Vendor: " + vendor, F(10), 40, 96);
        var heats = items.Select(r => S(r, "heat")).Where(v => v != "").Distinct().ToList();
        string[] mh = { "HEAT", "C", "Mn", "P", "S", "Si", "YIELD (psi)", "TENSILE (psi)", "ELONG %" }; var mx = new[] { 40.0, 130, 175, 220, 265, 310, 360, 440, 520 };
        y = 130; g.DrawRectangle(new XSolidBrush(XColor.FromArgb(225, 225, 225)), 40, y - 2, 532, 16);
        for (int i = 0; i < mh.Length; i++) T(g, mh[i], F(7.5, true), mx[i] + 2, y);
        y += 20; int k = 0;
        foreach (var ht in heats)
        {
            var v = new[] { ht, (.18 + k * .01).ToString("0.00"), (.85 + k * .02).ToString("0.00"), ".012", ".008", (.20 + k * .01).ToString("0.00"), (56000 + k * 900).ToString("N0"), (74000 + k * 700).ToString("N0"), (24 + k % 3).ToString() };
            for (int i = 0; i < v.Length; i++) T(g, v[i], F(8.5, i == 0), mx[i] + 2, y);
            y += 16; k++; if (y > 700) break;
        }
        g.Dispose();

        // ---- purchase order ----
        foreach (var po in pos)
        {
            g = Page(d, "PURCHASE ORDER", "Nucor Building Systems Texas", bol);
            T(g, "PO Number: " + po, F(13, true), 40, 96); T(g, "Vendor: " + vendor, F(10), 40, 120);
            T(g, "This Purchase Order Number must appear on all packages, invoices and packing slips.", F(8.5), 40, 142, Mute);
            y = 180; g.DrawRectangle(new XSolidBrush(XColor.FromArgb(225, 225, 225)), 40, y - 2, 532, 16);
            T(g, "L/N", F(7.5, true), 42, y); T(g, "ITEM / DESCRIPTION", F(7.5, true), 80, y); T(g, "ORDERED (lbs)", F(7.5, true), 470, y);
            y += 20; int ln = 1;
            foreach (var r in items.Where(r => S(r, "po") == po))
            {
                T(g, (ln++).ToString(), F(8.5), 42, y); T(g, S(r, "desc") + "  " + S(r, "len"), F(8.5), 80, y); T(g, S(r, "wt"), F(8.5), 480, y);
                y += 16; if (y > 700) break;
            }
            g.Dispose();
        }
        using var ms = new MemoryStream(); d.Save(ms, false); return ms.ToArray();
    }
}
