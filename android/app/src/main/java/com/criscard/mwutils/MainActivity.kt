package com.criscard.mwutils

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import org.json.JSONObject

/**
 * App full-immersive: carica makerworld.com/en/points nel WebView e inietta la
 * dashboard come overlay nel contesto della pagina (stessa tecnica dell'estensione
 * Chrome). Tutte le chiamate HTTP verso MakerWorld avvengono dal contesto della
 * pagina: motore Chromium vero, cookie di sessione automatici e nessun blocco
 * Cloudflare/CORS (un client HTTP nativo verrebbe bloccato con 403).
 */
class MainActivity : Activity() {

    companion object {
        private const val MW = "https://makerworld.com"
        private const val POINTS_URL = "$MW/en/points"
        private const val AUTH_CHECK_URL = "$MW/api/v1/point-service/point-bill/my?filter=all&limit=1"
        private const val PROBE_INTERVAL_MS = 2500L

        /** User-Agent da browser Chrome mobile: necessario per il login (incl. Google sign-in). */
        private const val UA =
            "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"

        /**
         * Probe di autenticazione eseguita NEL CONTESTO della pagina makerworld.com
         * (same-origin): passa Cloudflare e porta automaticamente i cookie di sessione.
         * Riporta l'esito al bridge nativo.
         */
        private val AUTH_PROBE_JS = """(function(){
  if (window.__mwProbeBusy) { return 'busy'; }
  window.__mwProbeBusy = true;
  fetch("$AUTH_CHECK_URL", {credentials:"include"})
    .then(function(r){ return r.text().then(function(t){ return {status:r.status, body:t}; }); })
    .then(function(o){
      window.__mwProbeBusy = false;
      MwBridge.authResult(o.status, o.body.indexOf("hits") !== -1 ? 1 : 0);
    })
    .catch(function(){ window.__mwProbeBusy = false; MwBridge.authResult(-1, 0); });
  return "ok";
})();"""
    }

    private enum class Mode { LOADING, LOGIN, DASHBOARD }

    private lateinit var webView: WebView
    private val handler = Handler(Looper.getMainLooper())

    @Volatile
    private var mode = Mode.LOADING

    @Volatile
    private var probing = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        CookieManager.getInstance().setAcceptCookie(true)

        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            userAgentString = UA
            loadWithOverviewMode = true
            useWideViewPort = true
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
        webView.setBackgroundColor(Color.parseColor("#0B0F14"))
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(Bridge(), "MwBridge")
        webView.webViewClient = AppWebViewClient()

        setContentView(webView)

        // Partiamo direttamente dalla pagina punti: se l'utente non è loggato
        // MakerWorld mostra la schermata di accesso, la probe rileva il login.
        mode = Mode.LOADING
        webView.loadUrl(POINTS_URL)
        startProbing()
    }

    // ---------------------------------------------------------------------
    // WebView client
    // ---------------------------------------------------------------------

    private inner class AppWebViewClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
            return when (mode) {
                // In dashboard: i link interni a makerworld restano nell'app,
                // i link esterni si aprono nel browser di sistema.
                Mode.DASHBOARD -> {
                    if (url.startsWith(MW)) false
                    else {
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        } catch (e: Exception) { /* ignora */ }
                        true
                    }
                }
                // In login: navigazione libera (provider OAuth, ecc.)
                else -> false
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            when (mode) {
                Mode.LOADING, Mode.LOGIN -> runProbe()
                // Full-page navigation ricarica la pagina: reiniettiamo l'overlay.
                Mode.DASHBOARD -> injectDashboard()
            }
        }
    }

    // ---------------------------------------------------------------------
    // Probe autenticazione (nel contesto pagina) + ciclo
    // ---------------------------------------------------------------------

    private fun startProbing() {
        if (probing) return
        probing = true
        scheduleProbe(1000)
    }

    private fun stopProbing() {
        probing = false
        handler.removeCallbacksAndMessages(null)
    }

    private fun scheduleProbe(delay: Long) {
        if (!probing) return
        handler.postDelayed({
            if (!probing) return@postDelayed
            runProbe()
            scheduleProbe(PROBE_INTERVAL_MS)
        }, delay)
    }

    private fun runProbe() {
        if (mode == Mode.DASHBOARD) return
        // evaluateJavascript esegue nella pagina corrente: se siamo su una
        // pagina diversa da makerworld (es. OAuth Google) la fetch faila e
        // la probe riparte al giro successivo.
        webView.evaluateJavascript(AUTH_PROBE_JS, null)
    }

    // ---------------------------------------------------------------------
    // Iniezione della dashboard come overlay full-screen
    // ---------------------------------------------------------------------

    private fun readAsset(path: String): String =
        assets.open(path).bufferedReader().use { it.readText() }

    private fun injectDashboard() {
        val html = readAsset("dashboard/overlay.html")
        val css = readAsset("dashboard/css/styles.css")
        val js = readAsset("dashboard/js/app.js")

        val script = buildString {
            append("(function(){")
            append("var d=document;")
            append("var old=d.getElementById('mw-root'); if(old){old.remove();}")
            // CSS: preferiamo constructable stylesheets (immuni da CSP),
            // con fallback su <style> inline.
            append("try{")
            append("var sheet=new CSSStyleSheet(); sheet.replaceSync(")
            append(JSONObject.quote(css))
            append("); document.adoptedStyleSheets=document.adoptedStyleSheets.concat([sheet]);")
            append("}catch(e){")
            append("var st=d.createElement('style'); st.textContent=")
            append(JSONObject.quote(css))
            append("; d.head.appendChild(st);")
            append("}")
            // Markup della dashboard
            append("var root=d.createElement('div'); root.id='mw-root'; root.innerHTML=")
            append(JSONObject.quote(html))
            append("; d.body.appendChild(root);")
            append("try{d.body.style.overflow='hidden';}catch(e){}")
            // JS della dashboard: eseguito direttamente da evaluateJavascript
            // (non soggetto a CSP, a differenza di uno <script> inline).
            append(js)
            append("})();")
        }
        webView.evaluateJavascript(script, null)
    }

    // ---------------------------------------------------------------------
    // Bridge JavaScript <-> Android
    // ---------------------------------------------------------------------

    inner class Bridge {

        /** Chiamata dalla probe JS con l'esito del controllo autenticazione. */
        @JavascriptInterface
        fun authResult(status: Int, authenticated: Int) {
            if (authenticated != 1 || mode == Mode.DASHBOARD) return
            CookieManager.getInstance().flush() // persiste la sessione per i prossimi avvii
            runOnUiThread {
                if (mode == Mode.DASHBOARD) return@runOnUiThread
                stopProbing()
                mode = Mode.DASHBOARD
                Toast.makeText(this@MainActivity, "Login effettuato!", Toast.LENGTH_SHORT).show()
                if (webView.url != null && webView.url!!.startsWith("$MW/en/points")) {
                    injectDashboard()
                } else {
                    webView.loadUrl(POINTS_URL) // onPageFinished inietterà la dashboard
                }
            }
        }

        /** Richiesto dalla dashboard quando le API rispondono 401/403 (sessione scaduta). */
        @JavascriptInterface
        fun openLogin() {
            runOnUiThread {
                mode = Mode.LOADING
                startProbing()
                webView.loadUrl(POINTS_URL)
                Toast.makeText(this@MainActivity, "Sessione scaduta: effettua di nuovo l'accesso", Toast.LENGTH_LONG).show()
            }
        }

        @JavascriptInterface
        fun logout() {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            runOnUiThread {
                mode = Mode.LOADING
                startProbing()
                webView.loadUrl(POINTS_URL)
            }
        }

        @JavascriptInterface
        fun toast(message: String) {
            runOnUiThread {
                Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show()
            }
        }

        @JavascriptInterface
        fun appVersion(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "1.1.0"
        } catch (e: Exception) {
            "1.1.0"
        }
    }

    // ---------------------------------------------------------------------
    // Ciclo di vita
    // ---------------------------------------------------------------------

    override fun onBackPressed() {
        when (mode) {
            // In dashboard il back riduce l'app (full-immersive), senza navigare via.
            Mode.DASHBOARD -> moveTaskToBack(true)
            Mode.LOGIN -> if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
            else -> super.onBackPressed()
        }
    }

    override fun onDestroy() {
        stopProbing()
        super.onDestroy()
    }
}
