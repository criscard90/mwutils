package com.criscard.mwutils

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : Activity() {

    companion object {
        private const val APP_ASSETS_ORIGIN = "https://appassets.androidplatform.net"
        private const val DASHBOARD_URL = "$APP_ASSETS_ORIGIN/assets/dashboard/index.html"
        private const val LOADING_URL = "$APP_ASSETS_ORIGIN/assets/dashboard/loading.html"
        private const val MAKERWORLD = "https://makerworld.com"
        private const val AUTH_CHECK_URL =
            "$MAKERWORLD/api/v1/point-service/point-bill/my?filter=all&limit=1"
        private const val POLL_INTERVAL_MS = 2000L

        /** User-Agent da browser Chrome mobile: necessario per il login (incl. Google sign-in). */
        private const val UA =
            "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
    }

    private enum class Mode { CHECKING, LOGIN, DASHBOARD }

    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    @Volatile
    private var mode = Mode.CHECKING

    @Volatile
    private var loginPolling = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        CookieManager.getInstance().setAcceptCookie(true)

        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            userAgentString = UA
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
        webView.setBackgroundColor(Color.parseColor("#0B0F14"))
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(Bridge(), "MwBridge")
        webView.webViewClient = AppWebViewClient()

        root = FrameLayout(this)
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(root)

        webView.loadUrl(LOADING_URL)
        Thread { checkSession(initial = true) }.start()
    }

    // ---------------------------------------------------------------------
    // WebView client
    // ---------------------------------------------------------------------

    private inner class AppWebViewClient : WebViewClient() {
        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest
        ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean {
            val url = request.url.toString()
            return when (mode) {
                // In dashboard navighiamo solo sulle nostre pagine locali.
                Mode.DASHBOARD -> !url.startsWith(APP_ASSETS_ORIGIN)
                // In login lasciamo libera la navigazione (oauth/provider vari).
                else -> false
            }
        }
    }

    // ---------------------------------------------------------------------
    // Sessione / flusso di navigazione
    // ---------------------------------------------------------------------

    /** Esito del controllo sessione. */
    private enum class SessionResult { AUTHENTICATED, UNAUTHENTICATED, NETWORK_ERROR }

    private fun checkSession(initial: Boolean) {
        when (isSessionAlive()) {
            SessionResult.AUTHENTICATED -> runOnUiThread { showDashboard() }
            SessionResult.UNAUTHENTICATED -> runOnUiThread {
                if (initial) startLogin(hint = true) else showDashboard()
            }
            SessionResult.NETWORK_ERROR -> runOnUiThread {
                if (mode == Mode.CHECKING) {
                    // Rete non disponibile: riproviamo tra 5 secondi.
                    webView.loadUrl(LOADING_URL)
                    Thread {
                        try { Thread.sleep(5000) } catch (e: InterruptedException) { return@Thread }
                        checkSession(initial)
                    }.start()
                }
            }
        }
    }

    private fun isSessionAlive(): SessionResult {
        return try {
            val (code, body) = httpGet(AUTH_CHECK_URL)
            when {
                code == 200 && body.contains("\"hits\"") -> SessionResult.AUTHENTICATED
                code == 200 -> SessionResult.UNAUTHENTICATED
                code == 401 || code == 403 -> SessionResult.UNAUTHENTICATED
                else -> SessionResult.NETWORK_ERROR
            }
        } catch (e: Exception) {
            SessionResult.NETWORK_ERROR
        }
    }

    private fun startLogin(hint: Boolean) {
        mode = Mode.LOGIN
        loginPolling = true
        CookieManager.getInstance().flush()
        webView.loadUrl("$MAKERWORLD/en")
        if (hint) {
            Toast.makeText(
                this,
                "Accedi con la tua utenza MakerWorld (email/password o Google)",
                Toast.LENGTH_LONG
            ).show()
        }
        Thread { pollLogin() }.start()
    }

    private fun pollLogin() {
        while (loginPolling) {
            try {
                Thread.sleep(POLL_INTERVAL_MS)
            } catch (e: InterruptedException) {
                return
            }
            if (isSessionAlive() == SessionResult.AUTHENTICATED) {
                loginPolling = false
                runOnUiThread {
                    Toast.makeText(this, "Login effettuato!", Toast.LENGTH_SHORT).show()
                    showDashboard()
                }
            }
        }
    }

    private fun showDashboard() {
        mode = Mode.DASHBOARD
        loginPolling = false
        CookieManager.getInstance().flush()
        webView.loadUrl(DASHBOARD_URL)
    }

    // ---------------------------------------------------------------------
    // Networking nativo (usato dal bridge JS: nessuna limitazione CORS)
    // ---------------------------------------------------------------------

    private data class HttpResult(val code: Int, val body: String)

    private fun httpGet(url: String): HttpResult {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            conn.instanceFollowRedirects = false
            conn.requestMethod = "GET"
            conn.setRequestProperty("User-Agent", UA)
            conn.setRequestProperty("Accept", "application/json, text/html, */*")
            conn.setRequestProperty(
                "Cookie",
                CookieManager.getInstance().getCookie("https://makerworld.com") ?: ""
            )
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return HttpResult(code, body)
        } finally {
            conn.disconnect()
        }
    }

    // ---------------------------------------------------------------------
    // Bridge JavaScript <-> Android
    // ---------------------------------------------------------------------

    inner class Bridge {

        @JavascriptInterface
        fun fetchJson(url: String): String = fetchUrl(url)

        @JavascriptInterface
        fun fetchText(url: String): String = fetchUrl(url)

        private fun fetchUrl(url: String): String {
            // Solo API/pages di makerworld.com sono accessibili dal bridge.
            if (!url.startsWith(MAKERWORLD)) {
                return "{\"__error__\":\"URL non consentita\"}"
            }
            return try {
                val (code, body) = httpGet(url)
                if (code in 200..299) body
                else "{\"__error__\":\"HTTP $code\",\"__status__\":$code}"
            } catch (e: Exception) {
                val msg = (e.message ?: "errore di rete").replace("\"", "'")
                "{\"__error__\":\"$msg\"}"
            }
        }

        @JavascriptInterface
        fun openLogin() {
            runOnUiThread { startLogin(hint = true) }
        }

        @JavascriptInterface
        fun logout() {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            runOnUiThread { startLogin(hint = false) }
        }

        @JavascriptInterface
        fun toast(message: String) {
            runOnUiThread {
                Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show()
            }
        }

        @JavascriptInterface
        fun appVersion(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.0"
        } catch (e: Exception) {
            "1.0.0"
        }
    }

    // ---------------------------------------------------------------------
    // Ciclo di vita
    // ---------------------------------------------------------------------

    override fun onBackPressed() {
        // In login permettiamo il back del browser interno; in dashboard chiudiamo l'app.
        if (mode == Mode.LOGIN && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        loginPolling = false
        super.onDestroy()
    }
}
