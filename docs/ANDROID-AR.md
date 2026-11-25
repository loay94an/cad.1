# Android / Arabic adaptation

- Android package id: `com.loay94an.floorplan`
- Native shell: Capacitor Android 7; the original Vue + Three.js application remains the application UI and 3D engine.
- The Android workflow generates the native project in CI, type-checks and builds the web bundle, then creates a debug APK artifact.
- Local projects continue to use IndexedDB; the server/OIDC account features require a separately configured API and identity provider.
- Offline behavior depends on the PWA precache and browser storage. Verify on a physical device after each release.
- A debug APK is not a signed production release. Production distribution requires a protected signing key and release workflow.
