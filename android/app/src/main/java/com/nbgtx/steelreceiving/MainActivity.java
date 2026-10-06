package com.nbgtx.steelreceiving;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.RestrictionsManager;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.InputType;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Steel Receiving for tablets: a full-screen shell around the web app on the plant server.
 * The web app does all the work; this shell adds what a browser tab cannot give a dock tablet:
 * an icon, no address bar, the camera for photos, PDF downloads, and a server address Intune can set.
 */
public class MainActivity extends AppCompatActivity {
    private static final int REQ_CHOOSER = 1, REQ_CAMERA_PERM = 2;
    private static final String PREFS = "steelreceiving", KEY_URL = "server_url";

    private WebView web;
    private String serverUrl;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraUri;
    private long lastDownloadId = -1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);   // dock tablets stay awake while the app is open
        web = new WebView(this);
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.addView(adminCorner(), new FrameLayout.LayoutParams(dp(170), dp(64), Gravity.TOP | Gravity.START));
        setContentView(root);
        serverUrl = resolveServerUrl();
        setupWebView();
        ContextCompat.registerReceiver(this, downloadDone, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED);
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(serverUrl);
    }

    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density); }

    /** A value pushed by Intune app configuration, or null. */
    private String managed(String key) {
        try {
            RestrictionsManager rm = (RestrictionsManager) getSystemService(Context.RESTRICTIONS_SERVICE);
            Bundle b = rm == null ? null : rm.getApplicationRestrictions();
            String v = b == null ? null : b.getString(key);
            return v == null || v.trim().isEmpty() ? null : v.trim();
        } catch (Exception e) { return null; }
    }

    /**
     * Invisible touch area over the web page's "Steel Receiving" title (nothing there is clickable).
     * Press and hold it for 3 seconds to open the PIN box that leads to the server address.
     */
    private View adminCorner() {
        View v = new View(this);
        Handler h = new Handler(Looper.getMainLooper());
        Runnable open = this::askPin;
        v.setOnTouchListener((view, e) -> {
            int a = e.getActionMasked();
            if (a == MotionEvent.ACTION_DOWN) h.postDelayed(open, 3000);
            else if (a == MotionEvent.ACTION_UP || a == MotionEvent.ACTION_CANCEL) h.removeCallbacks(open);
            return true;
        });
        return v;
    }

    private void askPin() {
        EditText e = new EditText(this);
        e.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        e.setHint("Admin PIN");
        new AlertDialog.Builder(this).setTitle("Admin").setView(e)
            .setPositiveButton("OK", (d, w) -> {
                String pin = managed("admin_pin") != null ? managed("admin_pin") : BuildConfig.ADMIN_PIN;
                if (pin.equals(e.getText().toString().trim())) askServer();
                else Toast.makeText(this, "Wrong PIN", Toast.LENGTH_SHORT).show();
            }).setNegativeButton("Cancel", null).show();
    }

    /** Order of precedence: Intune managed setting, then what was typed on the tablet, then the built-in default. */
    private String resolveServerUrl() {
        String url = managed("server_url");
        if (url == null || url.trim().isEmpty()) url = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, null);
        if (url == null || url.trim().isEmpty()) url = BuildConfig.SERVER_URL;
        url = url.trim();
        if (!url.startsWith("http://") && !url.startsWith("https://")) url = "http://" + url;
        if (!url.endsWith("/")) url += "/";
        return url;
    }

    private void setupWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " SteelReceivingApp/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Object() {
            @JavascriptInterface public void retry() { runOnUiThread(() -> web.loadUrl(serverUrl)); }
            @JavascriptInterface public void changeServer() { runOnUiThread(MainActivity.this::askPin); }
        }, "Shell");

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                // stay inside the app for our own server; send anything else to the system browser
                String host = Uri.parse(serverUrl).getHost();
                if (host != null && host.equalsIgnoreCase(r.getUrl().getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (Exception ignored) { }
                return true;
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) showOffline(e.getDescription().toString());
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;
                if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED && wantsImages(params))
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_PERM);
                else launchChooser(params);
                pendingParams = params;
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                // only reached on HTTPS pages (browsers hide the camera API on plain HTTP)
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        web.setDownloadListener((url, ua, disposition, mime, length) -> download(url, ua, disposition, mime));
    }

    private WebChromeClient.FileChooserParams pendingParams;

    private boolean wantsImages(WebChromeClient.FileChooserParams p) {
        for (String t : p.getAcceptTypes()) if (t != null && t.startsWith("image")) return true;
        return false;
    }

    /** Camera (when the form asks for images) plus the normal file picker, in one chooser. */
    private void launchChooser(WebChromeClient.FileChooserParams params) {
        List<Intent> extra = new ArrayList<>();
        if (wantsImages(params) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            try {
                File dir = new File(getCacheDir(), "photos"); dir.mkdirs();
                File f = File.createTempFile("photo", ".jpg", dir);
                cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
                Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                cam.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                extra.add(cam);
            } catch (Exception ignored) { cameraUri = null; }
        }
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        String[] types = params.getAcceptTypes();
        pick.setType(types != null && types.length > 0 && !types[0].isEmpty() ? types[0] : "*/*");
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        Intent chooser = Intent.createChooser(pick, "Choose");
        // a form that asks for the camera ("capture") goes straight to it
        if (params.isCaptureEnabled() && !extra.isEmpty()) chooser = extra.get(0);
        else if (!extra.isEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extra.toArray(new Intent[0]));
        try { startActivityForResult(chooser, REQ_CHOOSER); }
        catch (Exception e) { finishChooser(null); }
    }

    private void finishChooser(Uri[] result) {
        if (filePathCallback != null) filePathCallback.onReceiveValue(result);
        filePathCallback = null;
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req != REQ_CHOOSER) { super.onActivityResult(req, res, data); return; }
        Uri[] out = null;
        if (res == Activity.RESULT_OK) {
            if (data == null || (data.getData() == null && data.getClipData() == null)) { if (cameraUri != null) out = new Uri[]{cameraUri}; }
            else if (data.getClipData() != null) {
                out = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < out.length; i++) out[i] = data.getClipData().getItemAt(i).getUri();
            } else out = new Uri[]{data.getData()};
        }
        cameraUri = null;
        finishChooser(out);
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (req == REQ_CAMERA_PERM && pendingParams != null) launchChooser(pendingParams);   // works with or without the camera
    }

    /** Hand a file to the system download manager (with the sign-in cookie), then open it when it finishes. */
    private void download(String url, String ua, String disposition, String mime) {
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            String name = URLUtil.guessFileName(url, disposition, mime);
            r.setMimeType(mime);
            r.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
            r.addRequestHeader("User-Agent", ua);
            r.addRequestHeader("X-Requested-With", "fetch");
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            lastDownloadId = dm.enqueue(r);
            Toast.makeText(this, "Downloading " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) { Toast.makeText(this, "Could not download: " + e.getMessage(), Toast.LENGTH_LONG).show(); }
    }

    private final BroadcastReceiver downloadDone = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            long id = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (id != lastDownloadId) return;
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            Uri uri = dm.getUriForDownloadedFile(id);
            if (uri == null) return;
            try { startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, dm.getMimeTypeForDownloadedFile(id)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); }
            catch (Exception e) { Toast.makeText(MainActivity.this, "Saved to Downloads", Toast.LENGTH_LONG).show(); }
        }
    };

    /** Shown when the server cannot be reached. */
    private void showOffline(String why) {
        String html = "<html><head><meta name=viewport content='width=device-width,initial-scale=1'></head>"
            + "<body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#F5F4F0;font:18px sans-serif;color:#1b2a26;text-align:center\">"
            + "<div style='padding:24px;max-width:520px'><h1 style='color:#213B34'>Cannot reach Steel Receiving</h1>"
            + "<p style='color:#5d6b66'>Check that the tablet is on the plant Wi-Fi.</p><p style='color:#8a948f;font-size:14px'>" + why.replace("<", "&lt;") + "<br>" + serverUrl.replace("<", "&lt;") + "</p>"
            + "<p><button onclick='Shell.retry()' style='font-size:20px;padding:16px 32px;border:0;border-radius:10px;background:#006325;color:#fff;font-weight:bold'>Try again</button></p>"
            + "<p><button onclick='Shell.changeServer()' style='font-size:16px;padding:12px 24px;border:1px solid #c9c7be;border-radius:10px;background:#fff'>Change server address</button></p></div></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private void askServer() {
        if (managed("server_url") != null) {
            new AlertDialog.Builder(this).setTitle("Server address")
                .setMessage("This tablet's server address is set by your administrator (Intune):

" + serverUrl)
                .setPositiveButton("OK", null).show();
            return;
        }
        EditText e = new EditText(this);
        e.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        e.setText(serverUrl);
        new AlertDialog.Builder(this).setTitle("Server address").setView(e)
            .setPositiveButton("Save", (d, w) -> {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_URL, e.getText().toString()).apply();
                serverUrl = resolveServerUrl();
                web.loadUrl(serverUrl);
            }).setNeutralButton("Use default", (d, w) -> {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(KEY_URL).apply();
                serverUrl = resolveServerUrl();
                web.loadUrl(serverUrl);
            }).setNegativeButton("Cancel", null).show();
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override protected void onResume() {
        super.onResume();
        web.onResume();
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override protected void onPause() { web.onPause(); CookieManager.getInstance().flush(); super.onPause(); }

    @Override protected void onDestroy() { try { unregisterReceiver(downloadDone); } catch (Exception ignored) { } super.onDestroy(); }
}
