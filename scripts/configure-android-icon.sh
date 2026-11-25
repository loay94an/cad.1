#!/usr/bin/env bash
set -euo pipefail

RES="android/app/src/main/res"
mkdir -p "$RES/drawable" "$RES/mipmap-anydpi-v26" "$RES/values"

cat > "$RES/values/ic_launcher_colors.xml" <<'XML'
<resources>
    <color name="ic_launcher_background">#061B3D</color>
</resources>
XML

cat > "$RES/drawable/ic_launcher_foreground.xml" <<'XML'
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="#00000000" android:strokeColor="#168FE8" android:strokeWidth="0.7"
        android:pathData="M14,22 L94,22 M14,40 L94,40 M14,58 L94,58 M14,76 L94,76 M22,14 L22,94 M40,14 L40,94 M58,14 L58,94 M76,14 L76,94 M94,14 L94,94"/>
    <path android:fillColor="#00000000" android:strokeColor="#FFFFFF" android:strokeWidth="5.2"
        android:strokeLineCap="square" android:strokeLineJoin="round"
        android:pathData="M12,48 L54,17 L96,48 M22,42 L22,87 L86,87 L86,42"/>
    <path android:fillColor="#00000000" android:strokeColor="#FFFFFF" android:strokeWidth="3.4"
        android:pathData="M52,44 L52,69 M52,60 L34,60 L34,87 M52,69 L72,69 L72,87"/>
    <path android:fillColor="#00D5E8" android:pathData="M31,41 L45,41 L45,44 L31,44 Z M63,41 L77,41 L77,44 L63,44 Z M22,68 L25,68 L25,80 L22,80 Z M83,53 L86,53 L86,66 L83,66 Z"/>
    <path android:fillColor="#FFFFFF" android:pathData="M29,49 L43,49 L43,55 L29,55 Z M60,48 L78,48 L78,55 L60,55 Z M62,75 L75,75 L75,82 L62,82 Z"/>
    <path android:fillColor="#00D5E8" android:pathData="M47,87 L61,87 L54,99 Z"/>
</vector>
XML

cat > "$RES/mipmap-anydpi-v26/ic_launcher.xml" <<'XML'
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
</adaptive-icon>
XML
cp "$RES/mipmap-anydpi-v26/ic_launcher.xml" "$RES/mipmap-anydpi-v26/ic_launcher_round.xml"
echo "Configured Floor Plan adaptive launcher icon"
