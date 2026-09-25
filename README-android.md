# MW Utils — App Android (Dashboard punti MakerWorld)

App Android full-immersive che replica la dashboard "points" dell'estensione Chrome:
effettua il login con la propria utenza MakerWorld la prima volta, poi mostra **solo la dashboard**.

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
  - `_next/data/{buildId}/en/my/data-overview/model.json?startDate=&endDate=` — download/stampi
    giornalieri per il grafico di andamento globale
  - `/api/v1/point-service/product/products?shop={market}` — gift card
- Chart.js viene caricato da CDN nel contesto pagina (come fa l'estensione); se il CDN non è
  raggiungibile la dashboard funziona comunque senza grafico.

## Cosa mostra la dashboard

Le 4 card principali (griglia 2×2), pensate per non duplicare informazioni:

1. **Punti ultimo giorno** — punti guadagnati nell'ultimo giorno con dati, **non arrotondati**
   (es. `169.63`), con importo USD equivalente (exclusive) e dettaglio regular/exclusive.
2. **Obiettivo (goal)** — replica del widget dell'estensione: anello di progresso SVG, punti
   exclusive **netti dei riscatti** (guadagnati − riscattati, come il calcolo dell'estensione)
   convertiti in USD, obiettivo in USD modificabile (default 1000 $, salvato in `localStorage`
   come `mw_points_goal_usd`), percentuale di avanzamento e ETA calcolata sulla media
   giornaliera exclusive.
3. **USD mese corrente** — valore in USD degli exclusive guadagnati nel mese corrente, con punti
   e giorni di attività del mese.
4. **Totale da sempre** — valore in USD di tutti gli exclusive guadagnati, con **media mensile** e
   **media giornaliera** in USD.

Più, sotto:

- **Gift card**: quante ne sono acquistabili con il saldo reale, valore totale, punti mancanti alla
  prossima card e barra di progresso. Market selezionabile (il market rilevato dall'API ha priorità);
  se il market scelto non ha prodotti l'app riprova senza parametro `shop` e mostra l'errore a video
  invece di restare vuota.
- **Grafico** punti giornalieri (regular / exclusive / spesi) con selettore **ultima settimana /
  ultimo mese / ultimo anno**.
- **Andamento globale**: grafico **download / stampi** dal tab "Global" dell'estensione
  (`_next/data/{buildId}/en/my/data-overview/model.json`), con selettore data di inizio
  (default 30 giorni fa, salvato in `localStorage` come `mw_global_start_date`). Se l'endpoint
  JSON non risponde si usa in fallback la pagina `/en/my/data-overview/model` (dati da
  `__NEXT_DATA__`, senza bisogno di buildId); in caso di errore la card riporta il motivo
  esatto (`errore HTTP …`, `struttura non riconosciuta`, `nessun dato nel periodo`, …).
- **Popular searches**: top 10 ricerche del giorno dalla pagina
  `/en/my/creator-center/popular-searches` (dati da `__NEXT_DATA__` →
  `inspirationalWordsList`, stessa sorgente e normalizzazione dell'estensione: score 0-100,
  dedup case-insensitive, ordinamento decrescente). Lista con rango, parola e barra in stile
  MakerWorld; il motivo di ogni errore resta scritto sulla card, e se la cache è già presente
  un refetch fallito non cancella i dati vecchi.
- **Quanto avrò tra…**: proiezione del **saldo attuale** (punti exclusive netti + corrispettivo USD)
  dopo **7 / 15 / 30 giorni** con la media giornaliera — nessun riferimento al totale cumulato
  storico.
- **Riepilogo mensile** (exclusive guadagnati/riscattati in USD).
- **Top modelli**, breakdown dell'ultimo giorno e modelli "freddi" (5 giorni senza punti).

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

- si attiva **automaticamente a ogni push/merge su `main`** (oltre che su tag `v*` e manualmente);
- a ogni push carica l'APK come **artifact** della run e lo pubblica nella release rolling
  **"Latest"** (tag `latest`, ricreata a ogni build: contiene sempre l'ultimo commit di `main`);
- su un tag `v*` pubblica invece una **release di versione** con release notes generate;
- firma con il keystore nei secrets `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` /
  `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`; **se assenti genera un keystore temporaneo**
  (l'APK è comunque installabile, ma ogni release è firmata con una chiave diversa: Android
  chiederà di disinstallare la versione precedente prima dell'aggiornamento).

Per una release di versione:

```bash
git tag v1.5.0 && git push origin v1.5.0
```

## Note e limitazioni

- Il login Google dentro WebView è permesso grazie allo User-Agent Chrome, ma resta soggetto
  alle policy di Google; il login **email/password è sempre affidabile**.
- Lo scambio di punti (0,066 $/punto) è la stessa costante usata dall'estensione.
- Il market per le gift card viene scelto nel selettore della dashboard (default IT) e salvato
  in locale.
