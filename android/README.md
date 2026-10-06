# Steel Receiving for Android tablets

A small native app that opens the Steel Receiving site full screen. All the work still happens on the server, so a server update reaches every tablet at once and the app rarely needs rebuilding.

What the app adds over a browser tab: its own icon, no address bar, the screen stays on, the camera for inspection photos, PDF downloads that open in a PDF viewer, and a server address that Intune can set.

## Build it

1. Open this `android` folder in Android Studio (File > Open). Let it sync. It downloads Gradle and the libraries the first time.
2. Debug build for a quick test: Run on a tablet or emulator.
3. Release build: **Build > Generate Signed App Bundle / APK > APK**. Create a keystore the first time and **keep it safe**: every future update must be signed with the same key.
4. The signed file is `app/release/app-release.apk`.

From the command line (after Android Studio has created the Gradle wrapper): `gradlew assembleRelease`.

## Server address

The default is `http://10.9.33.141:8091/`. To build a different one in: `gradlew assembleRelease -PserverUrl=http://host:port/`.

Order the app uses at start: Intune managed setting, then an address typed on the tablet, then the built-in default. If the server cannot be reached the app shows a "Cannot reach" page with **Try again** and **Change server address**.

**Changing the address on a tablet at any time:** press and hold the top-left corner of the screen (over the "Steel Receiving" title) for 3 seconds, enter the admin PIN, then type the new address. **Use default** clears it. The default PIN is `2580`; build another in with `-PadminPin=1234`, or have Intune set `admin_pin` (string). If Intune sets `server_url`, the box shows that address and cannot override it.

## Deploy with Intune

- Upload the signed `.apk` as a line-of-business app (Apps > Android > Add), or publish it as a private app in managed Google Play if your tablets are Android Enterprise devices. Which one applies depends on how the tablets are enrolled.
- Optional app configuration policy: key `server_url`, type string, value like `http://10.9.33.141:8091/`.
- To update the app: raise `versionCode` in `app/build.gradle`, build, sign with the same key, and upload the new file.

## Limits

- The plant server is on plain HTTP, so `network_security_config.xml` allows cleartext traffic. When the site moves to HTTPS, set `cleartextTrafficPermitted` to `false`.
- Admin sign-in uses Windows authentication, which the tablet app does not do. Admins use a desktop browser. Card and PIN sign-in works as normal.
- Barcode scanning with the live camera needs HTTPS, so the Scan button will not work until then. Photos work today through the camera chooser.
- Minimum Android 8 (API 26). Tested target: Android 10 tablets.
