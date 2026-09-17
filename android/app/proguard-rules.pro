# Regole ProGuard/R8: la minificazione è disabilitata, regole minime di sicurezza.
-keep class com.criscard.mwutils.MainActivity$Bridge { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
