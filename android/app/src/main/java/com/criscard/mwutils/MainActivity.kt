package com.criscard.mwutils

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
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

        /** Cooldown anti-loop tra due richieste di re-login dalla dashboard. */
        private const val OPEN_LOGIN_COOLDOWN_MS = 20000L

        /**
         * Se la probe non ha esito entro questo timeout (rete lenta, OAuth su
         * domini terzi, challenge), la cover di avvio si ritira e mostra la
         * pagina con il pulsante di fuga: mai restare su uno schermo bloccato.
         */
        private const val COVER_FALLBACK_MS = 12000L

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
      // Autenticati SOLO con HTTP 200 e corpo che contiene "hits":
      // un 401/403 (anche con "hits" nel corpo) NON è una sessione valida.
      var ok = (o.status === 200 && o.body.indexOf("hits") !== -1) ? 1 : 0;
      MwBridge.authResult(o.status, ok);
    })
    .catch(function(){ window.__mwProbeBusy = false; MwBridge.authResult(-1, 0); });
  return "ok";
})();"""
    }

    private enum class Mode { LOADING, LOGIN, DASHBOARD }

    private lateinit var webView: WebView
    private val handler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("mwutils", MODE_PRIVATE) }

    @Volatile
    private var mode = Mode.LOADING

    @Volatile
    private var probing = false

    /** Timestamp dell'ultimo openLogin richiesto (anti-loop). */
    private var lastOpenLoginAt = 0L

    /**
     * true se lo stato LOGIN è dovuto a un rifiuto effettivo della sessione
     * (401/403, re-login richiesto, logout): serve a mostrare il toast di
     * benvenuto solo per i login reali, non per un avvio con rete lenta.
     */
    private var loginChallenge = false

    /** Cover nativa di caricamento: oscura la pagina punti finché non serve vederla. */
    private lateinit var coverView: View

    /**
     * Timeout di sicurezza della cover: se la probe non ha ancora prodotto un
     * esito (sessione valida → dashboard, o → schermata di accesso), si passa
     * in LOGIN e la pagina viene mostrata col pulsante di fuga.
     */
    private val coverFallback = Runnable {
        if (mode == Mode.LOADING) {
            mode = Mode.LOGIN
            hideLoadingCover()
            injectLoginHelper()
        }
    }

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

        // Cover di caricamento nativa sopra la WebView: la pagina punti non è
        // visibile finché la probe non decide (dashboard o schermata di accesso).
        coverView = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#0B0F14"))
            addView(ProgressBar(this@MainActivity).apply {
                isIndeterminate = true
                indeterminateTintList = ColorStateList.valueOf(Color.parseColor("#00A48F"))
            }, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            ))
        }
        val root = FrameLayout(this).apply {
            addView(webView, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ))
            addView(coverView, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ))
        }
        setContentView(root)

        // Ripristina la sessione salvata (i cookie di sessione non sopravvivono
        // alla chiusura del processo: li riemettiamo nel CookieManager).
        restoreCookies()

        // Partiamo direttamente dalla pagina punti con la cover sopra: se la
        // sessione è valida la dashboard prende il suo posto senza che la
        // pagina MakerWorld sia mai apparsa; altrimenti la cover si ritira e
        // resta la schermata di accesso.
        mode = Mode.LOADING
        webView.loadUrl(POINTS_URL)
        startProbing()
        handler.postDelayed(coverFallback, COVER_FALLBACK_MS)
    }

    // ---------------------------------------------------------------------
    // Cover di caricamento
    // ---------------------------------------------------------------------

    private fun showLoadingCover() {
        coverView.visibility = View.VISIBLE
    }

    private fun hideLoadingCover() {
        coverView.visibility = View.GONE
    }

    // ---------------------------------------------------------------------
    // WebView client
    // ---------------------------------------------------------------------

    private inner class AppWebViewClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
            val scheme = try { Uri.parse(url).scheme ?: "" } catch (e: Exception) { "" }
            val isHttp = scheme == "http" || scheme == "https"
            return when (mode) {
                // In dashboard: http(s) su makerworld resta nell'app, tutto il
                // resto (altri domini e schemi custom/intent) va fuori dall'app.
                Mode.DASHBOARD -> {
                    if (isHttp && url.startsWith(MW)) false
                    else { openExternal(url); true }
                }
                // In login: http(s) nel WebView; gli schemi non-http (intent://,
                // schemi custom dei provider OAuth) NON vanno nel WebView perché
                // causano pagina bianca e rompono il flusso: li deleghiamo al sistema.
                else -> {
                    if (isHttp) false
                    else { openExternal(url); true }
                }
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            when (mode) {
                // In LOADING la cover oscura la pagina: niente pulsante di
                // fuga, la probe decide se serve la schermata di accesso.
                Mode.LOADING -> runProbe()
                // In LOGIN la pagina di accesso è visibile: serve il pulsante
                // di fuga (challenge Cloudflare, OAuth su domini terzi, ...).
                Mode.LOGIN -> {
                    runProbe()
                    injectLoginHelper()
                }
                // Full-page navigation ricarica la pagina: reiniettiamo l'overlay.
                Mode.DASHBOARD -> {
                    saveCookies()
                    injectDashboard()
                }
            }
        }
    }

    /** Apre l'URL fuori dall'app (browser o app target dello schema). */
    private fun openExternal(url: String) {
        try {
            val intent: Intent = if (url.startsWith("intent://")) {
                Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
            } else {
                Intent(Intent.ACTION_VIEW, Uri.parse(url))
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
        } catch (e: Exception) { /* nessuna app compatibile: ignora */ }
    }

    /**
     * Persiste i cookie di sessione in SharedPreferences: i session-cookie del
     * WebView vengono scartati alla chiusura del processo, quindi li salviamo
     * e li ripristiniamo all'avvio.
     */
    private fun saveCookies() {
        try {
            val ck = CookieManager.getInstance().getCookie("https://makerworld.com")
            if (!ck.isNullOrBlank()) {
                prefs.edit().putString("mw_cookies", ck).apply()
            }
        } catch (e: Exception) { /* ignora */ }
    }

    private fun restoreCookies() {
        try {
            val saved = prefs.getString("mw_cookies", null) ?: return
            val cm = CookieManager.getInstance()
            saved.split(";").forEach { raw ->
                val pair = raw.trim()
                if (pair.isNotEmpty() && pair.contains("=")) {
                    cm.setCookie("https://makerworld.com", "$pair; Path=/")
                }
            }
            cm.flush()
        } catch (e: Exception) { /* ignora */ }
    }

    /**
     * Piccolo pulsante "di fuga" mostrato durante il login: se la probe non
     * riesce (es. challenge Cloudflare o OAuth su domini terzi), l'utente può
     * comunque forzare l'apertura della dashboard.
     */
    private fun injectLoginHelper() {
        webView.evaluateJavascript("""(function(){
  if (document.getElementById('mw-login-helper')) { return; }
  var b = document.createElement('button');
  b.id = 'mw-login-helper';
  b.textContent = 'Apri la dashboard MW Utils';
  b.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:12px 22px;border-radius:24px;border:none;background:#00A48F;color:#fff;font-weight:700;font-size:14px;box-shadow:0 6px 20px rgba(0,0,0,0.45);';
  b.addEventListener('click', function(){ MwBridge.forceDashboard(); });
  document.body.appendChild(b);
})();""", null)
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
            append("var old=d.getElementById('mw-root'); if(old){ window.MwBridge.dashboardReady(); return; }")
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
            // In caso di errore avvisiamo l'utente invece di lasciare schermo bianco.
            append("try{")
            append(js)
            append("}catch(e){ try{ window.MwBridge.toast('Errore dashboard: ' + (e && e.message ? e.message : e)); }catch(e2){} }")
            // Il pulsante di fuga non serve più: la dashboard lo copre comunque,
            // ma lo rimuoviamo esplicitamente per non lasciarlo nel DOM.
            append("try{var hp=d.getElementById('mw-login-helper'); if(hp&&hp.parentNode){hp.parentNode.removeChild(hp);}}catch(e){}")
            // Dopo due frame la dashboard è dipinta: nascondi la cover nativa.
            append("try{requestAnimationFrame(function(){requestAnimationFrame(function(){window.MwBridge.dashboardReady();});});}catch(e){ window.MwBridge.dashboardReady(); }")
            append("})();")
        }
        webView.evaluateJavascript(script, null)
        // Sicurezza: se il segnale JS non arriva (pagina tornata a caricare,
        // JS bloccato), la cover esce comunque dopo 2s.
        handler.postDelayed({ hideLoadingCover() }, 2000L)
    }

    // ---------------------------------------------------------------------
    // Bridge JavaScript <-> Android
    // ---------------------------------------------------------------------

    inner class Bridge {

        /** Chiamata dalla probe JS con l'esito del controllo autenticazione. */
        @JavascriptInterface
        fun authResult(status: Int, authenticated: Int) {
            if (mode == Mode.DASHBOARD) return
            if (authenticated == 1) {
                runOnUiThread {
                    if (mode == Mode.DASHBOARD) return@runOnUiThread
                    // Toast solo per un login effettivo (si partiva dalla pagina
                    // di accesso): all'avvio con sessione valida non compare.
                    val freshLogin = mode == Mode.LOGIN && loginChallenge
                    stopProbing()
                    mode = Mode.DASHBOARD
                    loginChallenge = false
                    saveCookies()
                    if (freshLogin) {
                        Toast.makeText(this@MainActivity, "Login effettuato!", Toast.LENGTH_SHORT).show()
                    }
                    if (webView.url != null && webView.url!!.startsWith("$MW/en/points")) {
                        injectDashboard()
                    } else {
                        // Copriamo la pagina durante la navigazione: la cover
                        // viene ritirata dal segnale dashboardReady.
                        showLoadingCover()
                        webView.loadUrl(POINTS_URL) // onPageFinished inietterà la dashboard
                    }
                }
                return
            }
            // Risposta HTTP definitiva dalla quale la sessione non risulta
            // valida (401/403, o 200 senza dati): passa in LOGIN, scopri la
            // pagina (schermata di accesso MW) e mostra il pulsante di fuga.
            // status -1 = fetch fallita (pagina non pronta, OAuth su altro
            // dominio, rete) e 5xx = errore transitorio del server: restano in
            // attesa, al fallback della cover (COVER_FALLBACK_MS) il compito di
            // sbloccare la schermata.
            if (status in 200..499) {
                runOnUiThread {
                    if (mode != Mode.LOADING) return@runOnUiThread
                    mode = Mode.LOGIN
                    loginChallenge = true
                    hideLoadingCover()
                    injectLoginHelper()
                }
            }
        }

        /**
         * Chiamata dal JS della dashboard quando l'overlay è nel DOM e dipinto:
         * nasconde la cover nativa rivelando la dashboard.
         */
        @JavascriptInterface
        fun dashboardReady() {
            runOnUiThread { hideLoadingCover() }
        }

        /** Forza l'apertura della dashboard (pulsante "di fuga" nella pagina di login). */
        @JavascriptInterface
        fun forceDashboard() {
            runOnUiThread {
                stopProbing()
                mode = Mode.DASHBOARD
                saveCookies()
                // Durante il passaggio la cover evita di vedere la pagina MW.
                showLoadingCover()
                val u = webView.url
                if (u != null && u.startsWith("$MW/en/points")) {
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
                // Anti-loop: se la dashboard richiede il re-login più volte di
                // seguito in breve tempo (es. un'API che risponde 403 anche con
                // sessione valida), NON ricarichiamo la pagina: restiamo in
                // dashboard dove l'utente può usare "Aggiorna".
                val now = System.currentTimeMillis()
                if (now - lastOpenLoginAt < OPEN_LOGIN_COOLDOWN_MS) {
                    Toast.makeText(this@MainActivity,
                        "Sessione non valida: tocca Aggiorna nella dashboard per riprovare",
                        Toast.LENGTH_LONG).show()
                    return@runOnUiThread
                }
                lastOpenLoginAt = now
                mode = Mode.LOADING
                loginChallenge = true
                // Copriamo la pagina durante il re-login: la cover si ritira
                // quando la probe decide (accesso o di nuovo la dashboard).
                showLoadingCover()
                handler.removeCallbacks(coverFallback)
                handler.postDelayed(coverFallback, COVER_FALLBACK_MS)
                startProbing()
                webView.loadUrl(POINTS_URL)
                Toast.makeText(this@MainActivity, "Sessione scaduta: effettua di nuovo l'accesso", Toast.LENGTH_LONG).show()
            }
        }

        @JavascriptInterface
        fun logout() {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            prefs.edit().remove("mw_cookies").apply()
            runOnUiThread {
                mode = Mode.LOADING
                loginChallenge = true
                showLoadingCover()
                handler.removeCallbacks(coverFallback)
                handler.postDelayed(coverFallback, COVER_FALLBACK_MS)
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
            packageManager.getPackageInfo(packageName, 0).versionName ?: "1.6.0"
        } catch (e: Exception) {
            "1.6.0"
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
