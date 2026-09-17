# MW Utils — App Android (Dashboard punti MakerWorld)

App Android full-immersive che replicare la dashboard "points" dell'estensione Chrome:
efettua il login con la propria utenza MakerWorld la prima volta, poi mostra **solo la dashboard**.

## Architettura

- **App nativa Kotlin + WebView full-immersive**: l'app carica `makerworld.com/en/points` e
  **inietta la dashboard come overlay full-screen nel contesto della pagina** (stessa tecnica
  dell'estensione Chrome: CSS via constructable stylesheets, markup e JS via `evaluateJavascript`).
- **Perché l'iniezione**: le richieste HTTP native (`HttpURLConnection`) vengono bloccate da
  Cloudflare con 403; eseguendo le fetch **nel contesto della pagina** usiamo il motore Chromium
  vero, con cookie di sessione automatici, nessun problema CORS e nessun challenge Cloudflare.
- **Login**: se l'utente non è autenticato, la pagina punti mostra la schermata di accesso;
  una **probe same-origin** (fetch a `/api/v1/point-service/point-bill/my` eseguita ogni ~2,5s
  dentro la pagina) rileva il login riuscito e inietta la dashboard. I cookie restano nel
  `CookieManager` di Android: ai lanci successivi la dashboard appare subito.
- **Stesse API dell'estensione** (`mw_injected.js`), chiamate con `fetch()` same-origin:
  - `/api/v1/point-service/point-bill/my?filter=all&limit=10000` — storico punti
  - `/en/points` (HTML) → buildId → `_next/data/{buildId}/en/points.json` — saldo punti
  - `_next/data/{buildId}/en.json` — profilo utente (nome, avatar, download/prints)
  - `/api/v1/point-service/product/products?shop={market}` — gift card
- Chart.js viene caricato da CDN nel contesto pagina (come fa l'estensione); se il CDN non è
  raggiungibile la dashboard funziona comunque senza grafico.

## Cosa mostra la dashboard

- Card: **saldo punti**, exclusive guadagnati, valore stimato USD (0,066 $/punto), regular guadagnati
- **Grafico** punti giornalieri (regular / exclusive / spesi) con range 30g / 90g / tutto
- **Gift card**: quante acquistabili, progresso verso la prossima, market selezionabile
- **Previsioni**: media giornaliera exclusive e data stimata della prossima gift card
- **Riepilogo mensile** (exclusive guadagnati/riscattati in USD)
- **Top modelli**, breakdown dell'ultimo giorno e modelli "freddi" (5 giorni senza punti)

## Build locale

```bash
cd android
# opzionale: crea android/keystore.properties + il tuo release.keystore per firmare
gradle assembleRelease        # oppure: ./gradlew assembleRelease (genera prima il wrapper)
# APK: app/build/outputs/apk/release/app-release.apk
```

Per firmare in locale, crea `android/keystore.properties`:

```properties
storeFile=release.keystore
storePassword=*****
keyAlias=mwutils
keyPassword=*****
```

Senza `keystore.properties` l'APK release risulta **unsigned** (non installabile): per i test
usa `gradle assembleDebug`.

## Release automatiche (GitHub Actions)

Il workflow `.github/workflows/android-release.yml`:

- si attiva su **push di tag `v*`** o manualmente (workflow_dispatch);
- firma con il keystore nei secrets `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` /
  `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`; **se assenti genera un keystore temporaneo**
  (l'APK è comunque installabile, ma ogni release è firmata con una chiave diversa — per gli
  aggiornamenti installati usa i secrets);
- pubblica l'APK (`mwutils-<tag>.apk`) su una **GitHub Release**.

Per rilasciare:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

## Note e limitazioni

- Il login Google dentro WebView è permesso grazie allo User-Agent Chrome, ma resta soggetto
  alle policy di Google; il login **email/password è sempre affidabile**.
- Lo scambio di punti (0,066 $/punto) è la stessa costante usata dall'estensione.
- Il market per le gift card viene scelto nel selettore della dashboard (default IT) e salvato
  in locale.
