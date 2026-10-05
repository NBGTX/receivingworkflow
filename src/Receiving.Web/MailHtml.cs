using System.Net;
using System.Text;

namespace Receiving.Web;

/// <summary>Branded HTML + plain text email layout. Table based with inline styles so it renders in Outlook, Gmail and phones.</summary>
public static class MailHtml
{
    public record Item(string Po, string Heat, string Cc, string Desc, string Len, string Wt);
    public record Style(string Headline, string Chip, string ChipBg, string ChipFg, string Button);

    // Nucor palette: dark green, medium green, light green, pale green, light blue, light gray.
    const string Dark = "#213B34", Med = "#006325", Light = "#A1CEAD", Pale = "#D9E8E2", Gray = "#F5F4F0", Line = "#DCDAD2", Ink = "#1B2A26", Mute = "#5D6B66";
    const string Font = "Arial,Helvetica,sans-serif";

    public static Style StyleFor(string evt) => evt switch
    {
        "packet_created" => new("New packet ready for inspection", "Awaiting inspection", "#BFE2F6", "#0B4A6E", "Open packet"),
        "inspection_complete" => new("Review needed", "In review", "#FDF1D8", "#A15C00", "Review packet"),
        "review_complete" => new("Ready to receive in D365", "Ready to receive", Pale, Med, "Open packet"),
        "received" => new("Ready to authorize", "Ready to authorize", Pale, Med, "Authorize packet"),
        "reject" => new("Rejected item", "Reject", "#FBE4E4", "#A12626", "Open packet"),
        "filed" => new("Receiving complete", "Filed", Dark, "#FFFFFF", "View packet"),
        _ => new("Steel Receiving", "Notice", Pale, Dark, "Open Steel Receiving"),
    };

    static string E(string? s) => WebUtility.HtmlEncode(s ?? "");

    static string Paragraphs(string text)
    {
        var sb = new StringBuilder();
        foreach (var p in text.Replace("\r", "").Split("\n\n", StringSplitOptions.RemoveEmptyEntries))
            sb.Append($"<p style=\"margin:0 0 14px;font-size:16px;line-height:24px;color:{Ink};\">{E(p.Trim()).Replace("\n", "<br>")}</p>");
        return sb.ToString();
    }

    public static string Html(string siteName, Style st, string intro, IList<(string k, string v)> facts, IList<Item>? items, string? link, string buttonLabel, string preheader, string logoSrc)
    {
        var sb = new StringBuilder();
        sb.Append($@"<!doctype html><html lang=""en""><head><meta charset=""utf-8""><meta name=""viewport"" content=""width=device-width,initial-scale=1""><meta name=""color-scheme"" content=""light""><meta name=""supported-color-schemes"" content=""light""><title>{E(st.Headline)}</title></head>
<body style=""margin:0;padding:0;background:{Gray};-webkit-text-size-adjust:100%;"">
<div style=""display:none;max-height:0;overflow:hidden;opacity:0;color:{Gray};"">{E(preheader)}&#8199;&#847;&#8199;&#847;</div>
<table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""background:{Gray};""><tr><td align=""center"" style=""padding:24px 12px;"">
<table role=""presentation"" width=""600"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""width:100%;max-width:600px;"">
<tr><td style=""background:{Dark};border-radius:12px 12px 0 0;padding:20px 28px;"">
  <table role=""presentation"" cellpadding=""0"" cellspacing=""0"" border=""0""><tr>
   <td style=""vertical-align:middle;""><img src=""{logoSrc}"" width=""44"" height=""44"" alt="""" style=""display:block;border-radius:10px;border:0;""></td>
   <td style=""vertical-align:middle;padding-left:14px;font-family:{Font};"">
     <div style=""font-size:19px;line-height:22px;font-weight:bold;color:#FFFFFF;"">{E(siteName)}</div>
     <div style=""font-size:11px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:{Light};"">Nucor Building Systems Texas</div></td>
  </tr></table></td></tr>
<tr><td style=""background:#FFFFFF;border-left:1px solid {Line};border-right:1px solid {Line};padding:30px 28px 10px;font-family:{Font};"">
  <span style=""display:inline-block;background:{st.ChipBg};color:{st.ChipFg};font-size:12px;line-height:16px;font-weight:bold;padding:4px 12px;border-radius:99px;"">{E(st.Chip)}</span>
  <h1 style=""margin:14px 0 14px;font-size:26px;line-height:32px;color:{Dark};font-family:{Font};"">{E(st.Headline)}</h1>
  {Paragraphs(intro)}
</td></tr>");
        if (facts.Count > 0)
        {
            sb.Append($@"<tr><td style=""background:#FFFFFF;border-left:1px solid {Line};border-right:1px solid {Line};padding:4px 28px 8px;font-family:{Font};"">
 <table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""background:{Gray};border-left:4px solid {Med};border-radius:6px;""><tr><td style=""padding:14px 18px;"">
 <table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"">");
            foreach (var (k, v) in facts)
                sb.Append($@"<tr><td style=""padding:5px 0;width:130px;font-size:12px;line-height:18px;letter-spacing:.5px;text-transform:uppercase;color:{Mute};vertical-align:top;"">{E(k)}</td><td style=""padding:5px 0;font-size:15px;line-height:20px;font-weight:bold;color:{Dark};"">{E(v)}</td></tr>");
            sb.Append("</table></td></tr></table></td></tr>");
        }
        if (items is { Count: > 0 })
        {
            sb.Append($@"<tr><td style=""background:#FFFFFF;border-left:1px solid {Line};border-right:1px solid {Line};padding:14px 28px 4px;font-family:{Font};"">
 <div style=""font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:{Mute};margin-bottom:6px;"">Items on this packet</div>
 <table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"" style=""border:1px solid {Line};border-radius:6px;border-collapse:separate;font-size:13px;"">
 <tr style=""background:{Dark};"">");
            foreach (var h in new[] { "PO #", "Heat #", "CC #", "Description", "Length" })
                sb.Append($"<td style=\"padding:8px 10px;font-size:11px;letter-spacing:.4px;text-transform:uppercase;font-weight:bold;color:#FFFFFF;\">{h}</td>");
            sb.Append("</tr>");
            var i = 0;
            foreach (var it in items.Take(10))
            {
                var bg = i++ % 2 == 0 ? "#FFFFFF" : Gray;
                sb.Append($"<tr style=\"background:{bg};\"><td style=\"padding:8px 10px;color:{Ink};\">{E(it.Po)}</td><td style=\"padding:8px 10px;color:{Ink};\">{E(it.Heat)}</td><td style=\"padding:8px 10px;color:{Ink};font-weight:bold;\">{E(it.Cc)}</td><td style=\"padding:8px 10px;color:{Ink};\">{E(it.Desc)}</td><td style=\"padding:8px 10px;color:{Ink};\">{E(it.Len)}</td></tr>");
            }
            sb.Append("</table>");
            if (items.Count > 10) sb.Append($"<div style=\"margin-top:6px;font-size:12px;color:{Mute};\">and {items.Count - 10} more</div>");
            sb.Append("</td></tr>");
        }
        if (!string.IsNullOrEmpty(link))
            sb.Append($@"<tr><td style=""background:#FFFFFF;border-left:1px solid {Line};border-right:1px solid {Line};padding:22px 28px 8px;font-family:{Font};"" align=""left"">
 <table role=""presentation"" cellpadding=""0"" cellspacing=""0"" border=""0""><tr><td style=""background:{Med};border-radius:8px;"" bgcolor=""{Med}"">
  <a href=""{E(link)}"" style=""display:inline-block;padding:15px 30px;font-family:{Font};font-size:16px;line-height:20px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:8px;"">{E(buttonLabel)}</a></td></tr></table>
 <p style=""margin:14px 0 0;font-size:12px;line-height:18px;color:{Mute};"">Button not working? Paste this address into your browser:<br><a href=""{E(link)}"" style=""color:{Med};word-break:break-all;"">{E(link)}</a></p></td></tr>");
        sb.Append($@"<tr><td style=""background:#FFFFFF;border-left:1px solid {Line};border-right:1px solid {Line};height:22px;font-size:0;line-height:0;"">&nbsp;</td></tr>
<tr><td style=""background:{Pale};border:1px solid {Line};border-top:0;border-radius:0 0 12px 12px;padding:18px 28px;font-family:{Font};font-size:12px;line-height:18px;color:{Mute};"">
 This is an automatic message from {E(siteName)}. Replies are not monitored.<br>Notification settings are managed by your administrator.</td></tr>
</table></td></tr></table></body></html>");
        return sb.ToString();
    }

    public static string Text(string siteName, Style st, string intro, IList<(string k, string v)> facts, IList<Item>? items, string? link)
    {
        var sb = new StringBuilder();
        sb.AppendLine(st.Headline.ToUpperInvariant()).AppendLine(new string('-', Math.Min(60, st.Headline.Length))).AppendLine().AppendLine(intro.Replace("\r", "")).AppendLine();
        foreach (var (k, v) in facts) sb.AppendLine($"{k}: {v}");
        if (items is { Count: > 0 })
        {
            sb.AppendLine().AppendLine("Items:");
            foreach (var it in items.Take(10)) sb.AppendLine($"  {it.Po} | Heat {it.Heat} | CC {it.Cc} | {it.Desc}{(string.IsNullOrEmpty(it.Len) ? "" : " | " + it.Len)}");
            if (items.Count > 10) sb.AppendLine($"  and {items.Count - 10} more");
        }
        if (!string.IsNullOrEmpty(link)) sb.AppendLine().AppendLine("Open: " + link);
        sb.AppendLine().AppendLine("-- " + siteName + " (automatic message, replies are not monitored)");
        return sb.ToString();
    }
}
