function attachRecuperaTagsListener() {
    const btn = document.getElementById("recuperaTags");
    if (btn && !btn.dataset.listenerAttached) {
        btn.addEventListener("click", function () {
            const testi = Array.from(document.querySelectorAll('[class = "MuiChip-label MuiChip-labelMedium mw-css-s01idy"]'))
                .map(el => el.innerText);

            const arrayString = JSON.stringify(testi);
            navigator.clipboard.writeText(arrayString);

            swal("Done!", "Model tags copied to clipboard", "success", {
                buttons: false,
                timer: 1000
            });
        });
        btn.dataset.listenerAttached = "true";
    }
}

function attachInserisciTagsListener() {
    const btn = document.getElementById("inserisciTags");
    if (btn && !btn.dataset.listenerAttached) {
        btn.addEventListener("click", function () {
            swal({
                title: "Insert tags",
                text: "Choose how to insert tags. You can insert only your tags or only tags above the threshold.",
                content: {
                    element: "div",
                    attributes: {
                        innerHTML: `
                <div style="margin-bottom:8px;">
                    <input id="swal-tags-input" class="swal-content__input" type="text"
                        placeholder="Enter tags separated by commas or as an array (e.g. [1,2,3])" style="width:100%;margin-bottom:8px;">
                </div>
                <div style="display: flex; align-items: center; margin-bottom:8px;">
                    <label for="swal-min-occurrences" style="font-size:13px;color:#666">Min occurrences:</label>
                    <input id="swal-min-occurrences" class="swal-content__input" type="number" min="0" value="500" style="width:80px;margin-left:8px;">
                </div>
                <div style="margin-bottom:8px;">
                    <label for="swal-insert-mode" style="font-size:13px;color:#666">Insert mode:</label>
                    <select id="swal-insert-mode" class="swal-content__input" style="margin-left:8px;">
                        <option value="raw">Only my tags (no suggestions)</option>
                        <option value="threshold">Only tags above threshold</option>
                    </select>
                </div>
            `
                    }
                },
                buttons: ["Cancel", "OK"],
            }).then(async (value) => {
                if (value) {
                    const tagsInput = document.getElementById('swal-tags-input').value.trim();
                    const minOccurrences = parseInt(document.getElementById('swal-min-occurrences').value, 10) || 500;
                    const insertMode = document.getElementById('swal-insert-mode').value;

                    let tags = [];
                    let value = tagsInput;
                    if (value.startsWith("[") && value.endsWith("]")) {
                        try {
                            tags = JSON.parse(value);
                            if (!Array.isArray(tags)) tags = [];
                        } catch (e) {
                            tags = [];
                        }
                    }
                    if (!tags.length) {
                        tags = value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
                    }

                    if (!tags.length) {
                        swal("Error", "No valid tag entered", "error");
                        return;
                    }

                    if (insertMode === "raw") {
                        // Inserisci solo i tag specificati, senza suggerimenti
                        try {
                            await insertTags(tags);
                            removeUploadingBackdrop();
                            swal("Done!", "Tags will be inserted automatically", "success", {
                                buttons: false,
                                timer: 1000
                            });
                        } catch (e) {
                            console.warn('insertTags failed', e);
                            swal("Error", "Failed to insert tags", "error");
                        }
                        return;
                    }

                    // Mostra loader per le altre modalità
                    swal({
                        title: "Please wait...",
                        text: "Processing tags",
                        buttons: false,
                        closeOnClickOutside: false,
                        closeOnEsc: false,
                    });

                    let results = [];
                    const promises = [];
                    for (let i = 0; i < tags.length; i++) {
                        promises.push(new Promise((resolve, reject) => {
                            var xhr = new XMLHttpRequest();
                            var url = "https://makerworld.com/api/v1/search-service/suggest?keyword=" + encodeURIComponent(tags[i]) + "&type=design_tag";
                            xhr.open('GET', url, true);
                            xhr.setRequestHeader('Content-Type', 'application/json');
                            xhr.onload = function () {
                                if (xhr.status === 200 || xhr.status == 201) {
                                    try {
                                        var suggestions = JSON.parse(xhr.responseText).suggestions || [];
                                        suggestions.sort((a, b) => b.count - a.count);
                                        // push only the first/top suggestion (as an array) so downstream logic works
                                        if (suggestions.length) results.push([suggestions[0]]); else results.push([]);
                                        resolve();
                                    } catch (e) {
                                        reject(e);
                                    }
                                } else {
                                    reject(new Error('Errore nella richiesta API: ' + xhr.status));
                                }
                            };
                            xhr.onerror = function () {
                                reject(new Error('Errore di rete'));
                            };
                            xhr.send();
                        }));
                    }

                    try {
                        await Promise.all(promises);
                        swal.close();
                        var flattened = results
                            .map(subArray => subArray.filter(item => item.count > minOccurrences))
                            .filter(subArray => subArray.length > 0)
                            .flat();

                        // Deduplica
                        let uniqueMap = new Map();
                        flattened.forEach(item => {
                            const key = item.text.toLowerCase();
                            if (!uniqueMap.has(key)) uniqueMap.set(key, item);
                        });
                        let uniqueFlattened = Array.from(uniqueMap.values());

                        if (insertMode === "threshold") {
                            // Solo tag sopra la soglia
                            const textArray = uniqueFlattened.map(item => item.text);
                            confirmAndInsert(textArray);
                            return;
                        }

                        // For non-raw modes we simply use the deduplicated suggestions
                        const textArray = uniqueFlattened.map(item => item.text);
                        confirmAndInsert(textArray);

                    } catch (error) {
                        swal.close();
                        swal("Error", error.message, "error");
                    }
                }
            });
        });
        btn.dataset.listenerAttached = "true";

        // Create a small container for top tags under the Insert button (only once)
        try {
            if (!document.getElementById('mw-top-tags')) {
                const topTagsContainer = document.createElement('div');
                topTagsContainer.id = 'mw-top-tags';
                topTagsContainer.style.marginTop = '8px';
                topTagsContainer.style.fontSize = '13px';
                topTagsContainer.style.color = '#333';
                topTagsContainer.innerHTML = '<div style="font-weight:600;margin-bottom:6px">Top searches</div><div id="mw-top-tags-list" style="display:flex;flex-wrap:wrap;gap:6px"></div>';
                btn.parentNode.insertBefore(topTagsContainer, btn.nextSibling);
                // add a convenient "Remove all tags" button next to Insert tags
                try {
                    if (!document.getElementById('mw-remove-all-tags')) {
                        const remBtn = document.createElement('button');
                        remBtn.id = 'mw-remove-all-tags';
                        remBtn.type = 'button';
                        remBtn.className = "MuiButtonBase-root MuiButton-root MuiButton-contained MuiButton-containedPrimary MuiButton-sizeMedium MuiButton-containedSizeMedium MuiButton-colorPrimary MuiButton-root MuiButton-contained MuiButton-containedPrimary MuiButton-sizeMedium MuiButton-containedSizeMedium MuiButton-colorPrimary mw-css-1aawt91";
                        remBtn.textContent = 'Remove all tags';
                        remBtn.style.cssText = 'background:#e53935;color:#fff;margin-top:50px;margin-bottom:20px;margin-left:20px;';
                        remBtn.title = 'Remove all tags currently added';
                        remBtn.addEventListener('click', () => {
                            try {
                                // More robust approach: repeatedly query for the next delete icon
                                // and click it until none remain. This handles frameworks that
                                // re-render DOM nodes after each deletion (so static NodeLists
                                // often become stale and further clicks do nothing).
                                try {
                                    const first = document.querySelector('.tagItem-deleteIcon');
                                    if (!first) { try { swal('Info', 'No tags found to remove', 'info', { buttons: false, timer: 800 }); } catch (e) { } return; }
                                    const intervalMs = 10;
                                    const clickNextDynamic = () => {
                                        try {
                                            const el = document.querySelector('.tagItem-deleteIcon');
                                            if (!el) {
                                                try { swal('Done', 'All tags removed', 'success', { buttons: false, timer: 800 }); } catch (e) { }
                                                return;
                                            }
                                            if (!el.isConnected) { // wait a bit if not attached
                                                setTimeout(clickNextDynamic, intervalMs);
                                                return;
                                            }
                                            // dispatch a real mouse click event to better emulate user action
                                            const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
                                            el.dispatchEvent(evt);
                                        } catch (e) {
                                            console.warn('tag click failed', e);
                                        }
                                        setTimeout(clickNextDynamic, intervalMs);
                                    };
                                    // start the loop
                                    clickNextDynamic();
                                } catch (e) { console.warn('Remove all tags failed', e); }
                            } catch (e) { console.warn('Remove all tags failed', e); }
                        });
                        // insert the button before the top tags container so it appears next to the Insert button
                        btn.parentNode.insertBefore(remBtn, topTagsContainer);
                    }
                } catch (e) { /* ignore */ }
            }
        } catch (e) { }
    }
}

// Fetch top tags from the Makerworld popular-searches page by parsing __NEXT_DATA__
async function fetchTopTagsAndRender() {
    const listEl = document.getElementById('mw-top-tags-list');
    if (!listEl) return;
    listEl.innerHTML = '<div style="color:#666">Loading top tags...</div>';
    try {
        const resp = await fetch('https://makerworld.com/en/my/creator-center/popular-searches', { credentials: 'same-origin' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const text = await resp.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        const script = doc.getElementById('__NEXT_DATA__');
        if (!script) throw new Error('No __NEXT_DATA__ found');
        const json = JSON.parse(script.textContent || script.innerText || '{}');
        const arr = (((json || {}).props || {}).pageProps || {}).inspirationalWordsList || [];
        if (!Array.isArray(arr) || !arr.length) {
            listEl.innerHTML = '<div style="color:#666">No top tags found</div>';
            return;
        }

        // Map to {word, score} and round score, cap at 100; then filter and sort
        const mapped = arr.map(item => ({ word: (item.word || '').trim(), score: Math.min(100, Math.round(Number(item.score) || 0)) })).filter(x => x.word.length > 0 && x.score <= 100);
        // Deduplicate by word (keep highest score)
        const uniq = new Map();
        mapped.forEach(item => {
            const key = item.word.toLowerCase();
            if (!uniq.has(key) || (uniq.get(key).score < item.score)) uniq.set(key, item);
        });
        const deduped = Array.from(uniq.values());
        deduped.sort((a, b) => b.score - a.score);
        const top10 = deduped.slice(0, 10);

        if (!top10.length) {
            listEl.innerHTML = '<div style="color:#666">No top tags available</div>';
            return;
        }

        // Render clickable chips
        listEl.innerHTML = '';
        top10.forEach(t => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = `${t.word} (${t.score})`;
            btn.style.padding = '6px 8px';
            btn.style.fontSize = '12px';
            btn.style.border = '1px solid rgba(0,0,0,0.08)';
            btn.style.borderRadius = '6px';
            btn.style.background = 'linear-gradient(180deg,#fff,#f6f7fb)';
            btn.style.cursor = 'pointer';
            btn.addEventListener('click', async () => {
                try {
                    await insertTags([t.word]);
                    removeUploadingBackdrop();
                    // brief feedback
                    swal({ title: 'Inserted', text: `Inserted tag: ${t.word}`, icon: 'success', buttons: false, timer: 800 });
                } catch (e) {
                    console.warn('insertTags failed', e);
                }
            });
            listEl.appendChild(btn);
        });
    } catch (err) {
        listEl.innerHTML = `<div style="color:#b00">Error loading top tags</div>`;
        console.warn('fetchTopTagsAndRender error', err);
    }
}

// Observe DOM to call fetchTopTags once the container is available (handles SPA navigation)
const mwTopTagsObserver = new MutationObserver(function () {
    const listEl = document.getElementById('mw-top-tags-list');
    if (listEl) {
        // ensure we only fetch once per availability
        if (!listEl.dataset.loaded) {
            listEl.dataset.loaded = '1';
            fetchTopTagsAndRender();
        }
    }
});
mwTopTagsObserver.observe(document.body, { childList: true, subtree: true });

let todayPointsLoaded = false;
let pointsChartLoaded = false;


// Inserisce un grafico con la cronologia dei punti prima del footer sulla pagina /en/points
function attachPointsChart() {
    if (document.getElementById('mw-points-chart-container')) {
        pointsChartLoaded = true;
        return;
    }
    if (pointsChartLoaded) pointsChartLoaded = false;
    try {
        if (!location.href.includes('/en/points')) return;

        const pageContent = document.querySelector('.pageContent');
        if (!pageContent || !pageContent.firstElementChild) return;

        pointsChartLoaded = true;

        // Crea contenitore del grafico
        const container = document.createElement('div');
        container.id = 'mw-points-chart-container';
        // Config: personalizza il link BuyMeACoffee qui
        const BUYME_URL = 'https://www.buymeacoffee.com/criscard'; // <-- replace with your buymeacoffee URL
        const BUYME_LABEL = 'Support me!';
        // keep container sizing minimal (avoid forcing wide layout)
        container.style.margin = '20px auto';
        container.style.padding = '12px';
        container.style.width = 'calc(100% - 40px)';
        // allow absolutely positioned elements inside (for top-right button)
        container.style.position = 'relative';
        container.style.background = 'var(--card-bg, #fff)';
        container.style.border = '1px solid rgba(0,0,0,0.06)';
        container.style.borderRadius = '8px';
        container.style.boxSizing = 'border-box';
        container.innerHTML = `
                    <div style="display:flex;align-items:center;gap:8px;padding-right:48px;">
                        <h3 style="margin:0;font-size:16px;font-weight:600"></h3>
                    </div>
                    <br>
                    <!-- Last points summary (prominent) -->
                    <div id="mw-points-last-info" style="margin-top:8px;padding:10px;border-radius:8px;background:linear-gradient(90deg,#f6fbff,#eef7ff);display:flex;align-items:center;gap:12px;box-shadow:0 1px 4px rgba(12,32,80,0.04);">
                        <div id="mw-points-last-amount" style="font-size:20px;font-weight:700;color:#0b7a3f;min-width:96px;text-align:left">+0 pts</div>
                        <div style="flex:1;min-width:0">
                            <div id="mw-points-last-desc" style="font-size:13px;color:#666;line-height:1.2">No recent activity</div>
                            <div id="mw-points-last-small" style="font-size:12px;color:#555;margin-top:4px">Exclusive value shown in USD</div>                                            
                    </div>
                    <div id="mw-points-goal" style="font-size:13px;color:#666;margin-right:10%;"></div>
                    <!-- Absolute top-right BuyMe button (smaller) -->
                    <div style="position:absolute;top:8px;right:8px;">
                        <a id="mw-buyme-link" href="${BUYME_URL}" target="_blank" rel="noopener noreferrer" title="Support me on BuyMeACoffee" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#2b2b2b;text-decoration:none;padding:4px 8px;border-radius:6px;background:linear-gradient(180deg,#ffd54f,#ffca28);border:1px solid rgba(0,0,0,0.08);box-shadow:0 1px 3px rgba(0,0,0,0.06);font-weight:700;">
                            <img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="BuyMeACoffee" style="height:28px;width:auto;display:block;"/>
                            <span style="line-height:1">${BUYME_LABEL}</span>
                        </a>
                    </div>
            </div>
            <div style="display:flex;gap:12px;align-items:flex-start;">
                <div style="flex:1;min-width:480px;max-width:none;">
                    <div style="position:relative;height:320px;">
                        <canvas id="mw-points-chart" style="width:100%;height:100%"></canvas>
                    </div>
                    <div id="mw-points-details" style="font-size:12px;color:#333;margin-top:50px;display:none;max-height:280px;overflow:auto;border-top:1px dashed rgba(0,0,0,0.04);padding-top:6px"></div>
                    <div id="mw-points-chart-msg" style="font-size:13px;color:#666;margin-top:8px"></div>
                </div>
                <div id="mw-points-predictions" style="width:500px;flex:0 0 500px;background:transparent;padding:6px;border-left:1px dashed rgba(0,0,0,0.04);">
                    <button id="mw-points-details-toggle" style="font-size:12px;padding:4px 6px;cursor:pointer;margin-left:90%">Details</button>
                    <div id="mw-points-monthly-stats" style="font-size:13px;color:#666;margin-top:8px;"></div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;margin-top:103px;">
                    <div id="mw-points-predictions-title" style="font-size:13px;color:#666;font-weight:600;display:none;">Projections</div>
                    </div>
                    <div id="mw-points-predictions-content" style="font-size:13px;color:#666;max-height:240px;overflow:auto;display:none;"></div>
                </div>
            </div>
            <!-- footer: update info (placed at the end so it's always visible, not inside hidden details) -->
            <div id="mw-points-footer" style="font-size:12px;color:#666;margin-top:12px;border-top:1px dashed rgba(0,0,0,0.04);padding-top:8px">Data from your account — dates shown in UTC for consistent aggregation — auto-updates every 5s</div>
        `;

        const msg = container.querySelector('#mw-points-chart-msg');

        // Insert as last child of the first child of .pageContent
        pageContent.firstElementChild.appendChild(container);

        // --- Tabs and Models panel (added) ---
        (function setupModelsUI() {
            try {
                const headerH3 = container.querySelector('h3');

                const giftcardsIndicator = document.createElement('div');
                giftcardsIndicator.id = 'mw-giftcards-indicator';
                giftcardsIndicator.style.marginBottom = '12px';
                giftcardsIndicator.style.marginTop = '8px';
                if (headerH3 && headerH3.parentNode) headerH3.parentNode.insertBefore(giftcardsIndicator, headerH3.nextSibling);

                // Fetch and render the indicator content
                renderGiftcardsIndicator();

                const tabs = document.createElement('div');
                tabs.id = 'mw-points-tabs';
                tabs.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:8px';
                tabs.innerHTML = `
                    <button id="mw-tab-history" type="button" style="padding:6px 8px;border-radius:6px;border:1px solid #ddd;background:linear-gradient(180deg,#fff,#f6f7fb);cursor:pointer;">Points overview</button>
                    <button id="mw-tab-models" type="button" style="padding:6px 8px;border-radius:6px;border:1px solid #ddd;background:linear-gradient(180deg,#fff,#f6f7fb);cursor:pointer">Models trend</button>
                    <button id="mw-tab-global" type="button" style="padding:6px 8px;border-radius:6px;border:1px solid #ddd;background:linear-gradient(180deg,#fff,#f6f7fb);cursor:pointer">Global trend</button>
                `;
                if (giftcardsIndicator && giftcardsIndicator.parentNode) giftcardsIndicator.parentNode.insertBefore(tabs, giftcardsIndicator.nextSibling);
                else if (headerH3 && headerH3.parentNode) headerH3.parentNode.insertBefore(tabs, headerH3.nextSibling);

                // left chart wrapper and model panel
                const chartCanvas = container.querySelector('#mw-points-chart');
                const chartWrap = chartCanvas ? chartCanvas.parentNode : null;

                const modelPanel = document.createElement('div');
                modelPanel.id = 'mw-models-panel';
                modelPanel.style.display = 'none';
                modelPanel.style.marginTop = '8px';
                modelPanel.innerHTML = `
                    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
                        <label style="font-size:13px;color:#666">Start date: <input id="mw-model-start-date" type="date" style="margin-left:6px;padding:6px;border:1px solid #ddd;border-radius:6px"/></label>
                        <label style="font-size:13px;color:#666">Metric: <select id="mw-model-metric-select" style="margin-left:6px;padding:6px;border:1px solid #ddd;border-radius:6px"><option value="points">Points</option><option value="downloads_prints">Downloads & Prints</option></select></label>
                        <button id="mw-model-refresh" style="padding:6px 8px;border-radius:6px;background:#1976d2;color:#fff;border:none;cursor:pointer">Refresh models</button>
                        <span style="font-size:12px;color:#666;margin-left:6px">End date auto: yesterday</span>
                    </div>
                    <div style="display:flex;gap:8px;align-items:flex-start">
                        <div style="flex:1;min-width:220px">
                            <select id="mw-model-select" multiple size="6" style="width:fit-content;padding:6px;border:1px solid #ddd;border-radius:6px;font-size:13px;color:#666;background:#fff"></select>
                            <div style="margin-top:6px;display:flex;gap:6px"><button id="mw-model-load" style="padding:6px 8px;border-radius:6px;background:#0b7a3f;color:#fff;border:none;cursor:pointer">Load chart</button><button id="mw-model-clear" style="padding:6px 8px;border-radius:6px;background:#eee;border:none;cursor:pointer">Clear</button></div>
                        </div>
                        <div style="flex:2">
                            <div style="position:relative;height:260px;"><canvas id="mw-model-points-chart" style="width:100%;height:100%"></canvas></div>
                            <div id="mw-model-msg" style="font-size:12px;color:#666;margin-top:6px"></div>
                        </div>
                    </div>
                `;

                // Global trend panel
                const globalPanel = document.createElement('div');
                globalPanel.id = 'mw-global-panel';
                globalPanel.style.display = 'none';
                globalPanel.style.marginTop = '8px';
                globalPanel.innerHTML = `
                    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
                        <label style="font-size:13px;color:#666">Start date: <input id="mw-global-start-date" type="date" style="margin-left:6px;padding:6px;border:1px solid #ddd;border-radius:6px"/></label>
                        <label style="font-size:13px;color:#666">Metric: <select id="mw-global-metric-select" style="margin-left:6px;padding:6px;border:1px solid #ddd;border-radius:6px"><option value="downloads_prints">Downloads & Prints</option></select></label>
                        <button id="mw-global-refresh" style="padding:6px 8px;border-radius:6px;background:#1976d2;color:#fff;border:none;cursor:pointer">Refresh data</button>
                        <span style="font-size:12px;color:#666;margin-left:6px">End date auto: yesterday</span>
                    </div>
                    <div style="display:flex;gap:8px;align-items:flex-start">
                        <div style="flex:2">
                            <div style="position:relative;height:260px;"><canvas id="mw-global-points-chart" style="width:100%;height:100%"></canvas></div>
                            <div id="mw-global-msg" style="font-size:12px;color:#666;margin-top:6px"></div>
                        </div>
                    </div>
                `;

                if (chartWrap && chartWrap.parentNode) chartWrap.parentNode.insertBefore(modelPanel, chartWrap.nextSibling);
                if (chartWrap && chartWrap.parentNode) chartWrap.parentNode.insertBefore(globalPanel, chartWrap.nextSibling);

                // Data/cache
                const modelCache = { list: null, details: {} };

                function formatDateYMD(d) {
                    const yyyy = d.getUTCFullYear();
                    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
                    const dd = String(d.getUTCDate()).padStart(2, '0');
                    return `${yyyy}-${mm}-${dd}`;
                }

                function yesterdayYMD() {
                    const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
                    return formatDateYMD(d);
                }

                function getStoredBuildId() {
                    try {
                        // Preferred: find buildManifest script
                        const byBuild = Array.from(document.querySelectorAll('script[src]')).filter(s => (s.src || '').includes('buildManifest'));
                        if (byBuild.length) {
                            const id = byBuild[0].src.split('/')[5] || null;
                            if (id) {
                                const prev = localStorage.getItem('mw_build_manifest_id');
                                if (prev !== id) { localStorage.setItem('mw_build_manifest_id', id); modelCache.list = null; modelCache.details = {}; }
                                return id;
                            }
                        }

                        // Fallback: look for _next/static/<id>/ pattern in any script src
                        const allScripts = Array.from(document.querySelectorAll('script[src]'));
                        for (const s of allScripts) {
                            try {
                                const m = s.src.match(/_next\/static\/([^\/]+)\//);
                                if (m && m[1]) {
                                    const id = m[1];
                                    const prev = localStorage.getItem('mw_build_manifest_id');
                                    if (prev !== id) { localStorage.setItem('mw_build_manifest_id', id); modelCache.list = null; modelCache.details = {}; }
                                    return id;
                                }
                            } catch (e) { /* ignore per-script errors */ }
                        }

                        // Last resort: return stored value (may be null)
                        return localStorage.getItem('mw_build_manifest_id') || null;
                    } catch (e) { return localStorage.getItem('mw_build_manifest_id') || null; }
                }

                // Helper: try several key paths and return first defined value
                function tryPaths(obj, paths) {
                    try {
                        for (const p of paths) {
                            let cur = obj;
                            let ok = true;
                            for (const k of p) {
                                if (cur && (k in cur)) cur = cur[k]; else { ok = false; break; }
                            }
                            if (ok && typeof cur !== 'undefined') return cur;
                        }
                    } catch (e) { }
                    return null;
                }

                async function fetchModelList(startDate, endDate) {
                    const id = getStoredBuildId();
                    const listMsgEl = container.querySelector('#mw-model-msg');
                    if (!id) {
                        const err = 'buildManifest id not found; cannot construct models URL';
                        console.warn(err);
                        if (listMsgEl) listMsgEl.textContent = err;
                        throw new Error(err);
                    }
                    const url = `https://makerworld.com/_next/data/${id}/en/my/data-overview/model.json?startDate=${startDate}&endDate=${endDate}`;
                    try {
                        const r = await fetch(url, { credentials: 'same-origin' });
                        if (!r.ok) {
                            const err = 'HTTP ' + r.status + ' when fetching model list';
                            console.warn(err, url);
                            if (listMsgEl) listMsgEl.textContent = err;
                            throw new Error(err);
                        }
                        const j = await r.json();
                        // try multiple possible locations for the list
                        let arr = tryPaths(j, [
                            ['props', 'pageProps', 'statisticalList'],
                            ['pageProps', 'statisticalList'],
                            ['props', 'initialProps', 'pageProps', 'statisticalList'],
                            ['props', 'pageProps', 'data', 'statisticalList']
                        ]);
                        if (!Array.isArray(arr)) {
                            // If not found, log json for debugging and fallback to empty
                            console.debug('fetchModelList: unexpected JSON shape, raw:', j);
                            if (listMsgEl) listMsgEl.textContent = 'Unexpected models JSON shape (see console)';
                            arr = [];
                        }
                        modelCache.list = arr;
                        return arr;
                    } catch (e) {
                        console.warn('fetchModelList error', e, url);
                        if (listMsgEl) listMsgEl.textContent = 'Error loading models: ' + (e && e.message ? e.message : e);
                        throw e;
                    }
                }

                async function fetchModelDetail(designId, publishTime, endDate) {
                    const id = getStoredBuildId();
                    if (!id) throw new Error('buildManifest id not found');
                    const start = (publishTime || '').split('T')[0] || '';
                    const url = `https://makerworld.com/_next/data/${id}/en/my/data-overview/model/${designId}.json?designId=${designId}&startDate=${start}&endDate=${endDate}`;
                    const r = await fetch(url, { credentials: 'same-origin' });
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    const j = await r.json();
                    // try multiple locations for modelData
                    let arr = tryPaths(j, [
                        ['props', 'pageProps', 'modelData'],
                        ['pageProps', 'modelData'],
                        ['props', 'initialProps', 'pageProps', 'modelData']
                    ]);
                    if (!arr) {
                        console.debug('fetchModelDetail: unexpected JSON shape, raw:', j);
                        arr = {};
                    }
                    modelCache.details[designId] = arr;
                    return arr;
                }

                function populateModelSelect(list) {
                    const sel = container.querySelector('#mw-model-select');
                    if (!sel) return;
                    sel.innerHTML = '';
                    list.forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = m.designId;
                        opt.text = `${m.title}`;
                        opt.dataset.publish = m.publishTime || '';
                        sel.appendChild(opt);
                    });
                }

                async function loadModelsIfNeeded() {
                    const startInput = container.querySelector('#mw-model-start-date');
                    const startVal = startInput.value || localStorage.getItem('mw_model_start_date') || '';
                    if (startVal) localStorage.setItem('mw_model_start_date', startVal);
                    const startDate = startVal || formatDateYMD(new Date(Date.now() - 30 * 24 * 3600 * 1000));
                    const endDate = yesterdayYMD();
                    if (modelCache.list && modelCache._meta && modelCache._meta.startDate === startDate && modelCache._meta.endDate === endDate) {
                        populateModelSelect(modelCache.list);
                        return modelCache.list;
                    }
                    const list = await fetchModelList(startDate, endDate);
                    modelCache._meta = { startDate, endDate };
                    populateModelSelect(list);
                    return list;
                }

                async function renderModelChartForSelected() {
                    const sel = container.querySelector('#mw-model-select');
                    const msgEl = container.querySelector('#mw-model-msg');
                    if (!sel) return;
                    const opts = Array.from(sel.selectedOptions || []);
                    if (!opts.length) { msgEl.textContent = 'No model selected.'; return; }
                    msgEl.textContent = 'Loading model details...';
                    const endDate = yesterdayYMD();
                    const perModel = [];
                    for (const o of opts) {
                        const designId = o.value;
                        const publishTime = o.dataset.publish || '';
                        try {
                            const data = modelCache.details[designId] ? modelCache.details[designId] : await fetchModelDetail(designId, publishTime, endDate);
                            const dateList = (data && data.dateList) ? data.dateList : [];
                            perModel.push({ id: designId, title: o.text, dateList });
                        } catch (e) {
                            console.warn('model detail fetch failed', e);
                        }
                    }
                    if (!perModel.length) { msgEl.textContent = 'No data for selected models.'; return; }

                    // decide metric: 'points' (per-model lines) or 'downloads_prints' (two aggregated lines)
                    const metricSelect = container.querySelector('#mw-model-metric-select');
                    const metric = metricSelect ? (metricSelect.value || localStorage.getItem('mw_model_metric') || 'points') : (localStorage.getItem('mw_model_metric') || 'points');

                    // build union labels (YYYY-MM-DD) from intervalVal
                    const labelSet = new Set();
                    perModel.forEach(pm => pm.dateList.forEach(d => labelSet.add((d.intervalVal || '').replace(/\//g, '-'))));
                    const labels = Array.from(labelSet).sort();

                    // helper: extract downloads/prints robustly
                    function extractDownloads(d) {
                        if (!d) return 0;
                        if (typeof d.downloadCount === 'number') return d.downloadCount;
                        if (d.downloadCount && typeof d.downloadCount.default === 'number') return d.downloadCount.default;
                        if (typeof d.download === 'number') return d.download;
                        if (d.download && typeof d.download.default === 'number') return d.download.default;
                        if (typeof d.downloads === 'number') return d.downloads;
                        return 0;
                    }
                    function extractPrints(d) {
                        if (!d) return 0;
                        if (typeof d.printCount === 'number') return d.printCount;
                        if (d.printCount && typeof d.printCount.default === 'number') return d.printCount.default;
                        if (typeof d.print === 'number') return d.print;
                        if (d.print && typeof d.print.default === 'number') return d.print.default;
                        if (typeof d.prints === 'number') return d.prints;
                        return 0;
                    }

                    let datasets = [];
                    if (metric === 'downloads_prints') {
                        // build aggregated downloads & prints across selected models per date
                        const downloadsByDate = new Map();
                        const printsByDate = new Map();
                        perModel.forEach(pm => {
                            pm.dateList.forEach(d => {
                                const dateKey = (d.intervalVal || '').replace(/\//g, '-');
                                const dl = Number(extractDownloads(d)) || 0;
                                const pr = Number(extractPrints(d)) || 0;
                                downloadsByDate.set(dateKey, (downloadsByDate.get(dateKey) || 0) + dl);
                                printsByDate.set(dateKey, (printsByDate.get(dateKey) || 0) + pr);
                            });
                        });
                        const downloadsData = labels.map(l => downloadsByDate.get(l) || 0);
                        const printsData = labels.map(l => printsByDate.get(l) || 0);
                        datasets.push({ label: 'Downloads', data: downloadsData, borderColor: 'rgba(33,150,243,0.9)', backgroundColor: 'rgba(33,150,243,0.2)', fill: false, tension: 0.2 });
                        datasets.push({ label: 'Prints', data: printsData, borderColor: 'rgba(156,39,176,0.9)', backgroundColor: 'rgba(156,39,176,0.2)', fill: false, tension: 0.2 });
                    } else {
                        // default: per-model points lines (exclusive points)
                        datasets = perModel.map((pm, idx) => {
                            const map = new Map(pm.dateList.map(d => [(d.intervalVal || '').replace(/\//g, '-'), extractExclusive(d)]));
                            const data = labels.map(l => map.has(l) ? map.get(l) : 0);
                            const color = `hsl(${(idx * 60) % 360},70%,40%)`;
                            return { label: pm.title, data, borderColor: color, backgroundColor: color, fill: false, tension: 0.2 };
                        });
                    }

                    // destroy old model chart if present
                    try { if (window.__mw_model_points_chart && typeof window.__mw_model_points_chart.destroy === 'function') window.__mw_model_points_chart.destroy(); } catch (e) { }
                    const mc = container.querySelector('#mw-model-points-chart');
                    try {
                        window.__mw_model_points_chart = new Chart(mc.getContext('2d'), { type: 'line', data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { display: true }, y: { beginAtZero: true } }, plugins: { legend: { position: 'top' } } } });
                        msgEl.textContent = '';
                    } catch (e) {
                        msgEl.textContent = 'Chart error: ' + (e && e.message);
                    }
                }

                function extractExclusive(d) {
                    if (!d) return 0;
                    if (typeof d.pointFromModelExclusive === 'number') return d.pointFromModelExclusive;
                    if (d.pointFromModelExclusive && typeof d.pointFromModelExclusive.default === 'number') return d.pointFromModelExclusive.default;
                    if (typeof d.pointFromModel === 'number') return d.pointFromModel;
                    if (d.pointFromModel && typeof d.pointFromModel.default === 'number') return d.pointFromModel.default;
                    return 0;
                }

                // helper to mark active tab visually
                // Helper function to detect dark mode
                function isDarkMode() {
                    const hasDarkClass = document.documentElement.classList.contains('dark') ||
                        document.body.classList.contains('dark-theme');
                    const hasDarkAttribute = document.documentElement.getAttribute('data-theme') === 'dark';
                    return hasDarkClass || hasDarkAttribute;
                }

                function setActiveTab(activeBtn) {
                    try {
                        const darkMode = isDarkMode();

                        // Define colors based on mode
                        const colors = darkMode ? {
                            activeBg: 'linear-gradient(180deg,#1a1a2e,#16213e)',
                            activeBorder: '#1976d2',
                            inactiveBg: '#1e1e2e',
                            inactiveBorder: '#444',
                            textActive: '#fff',
                            textInactive: '#ccc'
                        } : {
                            activeBg: 'linear-gradient(180deg,#fff,#f6f7fb)',
                            activeBorder: '#1976d2',
                            inactiveBg: '#fff',
                            inactiveBorder: '#ddd',
                            textActive: '#000',
                            textInactive: '#333'
                        };

                        const b1 = container.querySelector('#mw-tab-history');
                        const b2 = container.querySelector('#mw-tab-models');
                        const b3 = container.querySelector('#mw-tab-global');
                        const all = [b1, b2, b3].filter(Boolean);
                        all.forEach(b => {
                            if (b === activeBtn) {
                                b.style.background = colors.activeBg;
                                b.style.border = '1px solid ' + colors.activeBorder;
                                b.style.color = colors.textActive;
                                b.style.fontWeight = '700';
                                b.style.boxShadow = '0 1px 4px rgba(25,118,210,0.12)';
                            } else {
                                b.style.background = colors.inactiveBg;
                                b.style.border = '1px solid ' + colors.inactiveBorder;
                                b.style.color = colors.textInactive;
                                b.style.fontWeight = 'normal';
                                b.style.boxShadow = 'none';
                            }
                        });
                    } catch (e) { }
                }

                // wire tabs
                const tabHistory = container.querySelector('#mw-tab-history');
                const tabModels = container.querySelector('#mw-tab-models');
                const tabGlobal = container.querySelector('#mw-tab-global');

                tabHistory && tabHistory.addEventListener('click', () => {
                    try {
                        const preds = container.querySelector('#mw-points-predictions');
                        const details = container.querySelector('#mw-points-details');
                        const predsContent = container.querySelector('#mw-points-predictions-content');
                        const predsTitle = container.querySelector('#mw-points-predictions-title');
                        if (chartWrap) chartWrap.style.display = 'block';
                        if (modelPanel) modelPanel.style.display = 'none';
                        if (globalPanel) globalPanel.style.display = 'none';
                        if (preds) preds.style.display = 'block';
                        // Details and projections should be hidden by default - only show when clicking "Details" button
                        if (details) details.style.display = 'none';
                        if (predsContent) predsContent.style.display = 'none';
                        if (predsTitle) predsTitle.style.display = 'none';
                        setActiveTab(tabHistory);
                    } catch (e) { /* ignore */ }
                });

                tabModels && tabModels.addEventListener('click', async () => {
                    try {
                        const preds = container.querySelector('#mw-points-predictions');
                        const details = container.querySelector('#mw-points-details');
                        if (chartWrap) chartWrap.style.display = 'none';
                        if (modelPanel) modelPanel.style.display = 'block';
                        if (globalPanel) globalPanel.style.display = 'none';
                        if (preds) preds.style.display = 'none';
                        if (details) details.style.display = 'none';
                        setActiveTab(tabModels);
                        try { await loadModelsIfNeeded(); } catch (e) { console.warn('loadModelsIfNeeded failed', e); }
                    } catch (e) { console.warn(e); }
                });

                tabGlobal && tabGlobal.addEventListener('click', async () => {
                    try {
                        const preds = container.querySelector('#mw-points-predictions');
                        const details = container.querySelector('#mw-points-details');
                        if (chartWrap) chartWrap.style.display = 'none';
                        if (modelPanel) modelPanel.style.display = 'none';
                        if (globalPanel) globalPanel.style.display = 'block';
                        if (preds) preds.style.display = 'none';
                        if (details) details.style.display = 'none';
                        setActiveTab(tabGlobal);
                        try { await loadGlobalIfNeeded(); } catch (e) { console.warn('loadGlobalIfNeeded failed', e); }
                    } catch (e) { console.warn(e); }
                });

                // initialize active tab
                setActiveTab(tabHistory);

                // wire model controls
                const refreshBtn = container.querySelector('#mw-model-refresh');
                const loadBtn = container.querySelector('#mw-model-load');
                const clearBtn = container.querySelector('#mw-model-clear');
                const startInput = container.querySelector('#mw-model-start-date');
                // initialize start date from storage or 30 days ago
                const storedStart = localStorage.getItem('mw_model_start_date');
                if (storedStart) startInput.value = storedStart; else { const d = new Date(); d.setUTCDate(d.getUTCDate() - 30); startInput.value = formatDateYMD(d); }

                // metric selector: persist selection and re-render chart on change
                const metricSelect = container.querySelector('#mw-model-metric-select');
                try {
                    const storedMetric = localStorage.getItem('mw_model_metric') || 'points';
                    if (metricSelect) metricSelect.value = storedMetric;
                    if (metricSelect) metricSelect.addEventListener('change', () => {
                        try { localStorage.setItem('mw_model_metric', metricSelect.value); } catch (e) { }
                        try { renderModelChartForSelected(); } catch (e) { }
                    });
                } catch (e) { }

                refreshBtn && refreshBtn.addEventListener('click', async () => { try { await loadModelsIfNeeded(); } catch (e) { console.warn(e); } });
                loadBtn && loadBtn.addEventListener('click', async () => { try { await renderModelChartForSelected(); } catch (e) { console.warn(e); } });
                clearBtn && clearBtn.addEventListener('click', () => { const sel = container.querySelector('#mw-model-select'); if (sel) { Array.from(sel.options).forEach(o => o.selected = false); } try { if (window.__mw_model_points_chart && typeof window.__mw_model_points_chart.destroy === 'function') window.__mw_model_points_chart.destroy(); } catch (e) { } });

                // wire global controls
                const globalRefreshBtn = container.querySelector('#mw-global-refresh');
                const globalStartInput = container.querySelector('#mw-global-start-date');
                // initialize start date from storage or 30 days ago
                const storedGlobalStart = localStorage.getItem('mw_global_start_date');
                if (storedGlobalStart) globalStartInput.value = storedGlobalStart; else { const d = new Date(); d.setUTCDate(d.getUTCDate() - 30); globalStartInput.value = formatDateYMD(d); }

                globalRefreshBtn && globalRefreshBtn.addEventListener('click', async () => { try { await loadGlobalIfNeeded(); } catch (e) { console.warn(e); } });

                // Global trend chart implementation
                async function loadGlobalIfNeeded() {
                    const container = document.getElementById('mw-global-panel');
                    if (!container) return;

                    const startInput = container.querySelector('#mw-global-start-date');
                    const startVal = startInput.value || localStorage.getItem('mw_global_start_date') || '';
                    if (startVal) localStorage.setItem('mw_global_start_date', startVal);
                    const startDate = startVal || formatDateYMD(new Date(Date.now() - 30 * 24 * 3600 * 1000));
                    const endDate = yesterdayYMD();

                    // Fetch global data from Makerworld API using model endpoint
                    const id = getStoredBuildId();
                    if (!id) {
                        const msgEl = container.querySelector('#mw-global-msg');
                        if (msgEl) msgEl.textContent = 'buildManifest id not found';
                        return;
                    }

                    const url = `https://makerworld.com/_next/data/${id}/en/my/data-overview/model.json?startDate=${startDate}&endDate=${endDate}`;
                    const msgEl = container.querySelector('#mw-global-msg');
                    if (msgEl) msgEl.textContent = 'Loading global data...';

                    try {
                        const r = await fetch(url, { credentials: 'same-origin' });
                        if (!r.ok) throw new Error('HTTP ' + r.status);
                        const j = await r.json();

                        // Extract statistical data with dateList (downloads and prints per day)
                        let globalData = [];
                        // try multiple possible locations for statisticalData
                        let arr = tryPaths(j, [
                            ['props', 'pageProps', 'statisticalData'],
                            ['pageProps', 'statisticalData'],
                            ['props', 'initialProps', 'pageProps', 'statisticalData'],
                            ['props', 'pageProps', 'data', 'statisticalData']
                        ]);
                        if (!arr) {
                            console.debug('loadGlobalIfNeeded: unexpected JSON shape, raw:', j);
                            arr = {};
                        }
                        globalData = arr;

                        // Build chart data by extracting downloads and prints from dateList
                        const labelSet = new Set();
                        const dateList = globalData.dateList || [];
                        dateList.forEach(d => labelSet.add((d.intervalVal || '').replace(/\//g, '-')));
                        const labels = Array.from(labelSet).sort();

                        // helper: extract downloads/prints robustly
                        function extractDownloads(d) {
                            if (!d) return 0;
                            if (typeof d.downloadCount === 'number') return d.downloadCount;
                            if (d.downloadCount && typeof d.downloadCount.default === 'number') return d.downloadCount.default;
                            if (typeof d.download === 'number') return d.download;
                            if (d.download && typeof d.download.default === 'number') return d.download.default;
                            if (typeof d.downloads === 'number') return d.downloads;
                            return 0;
                        }
                        function extractPrints(d) {
                            if (!d) return 0;
                            if (typeof d.printCount === 'number') return d.printCount;
                            if (d.printCount && typeof d.printCount.default === 'number') return d.printCount.default;
                            if (typeof d.print === 'number') return d.print;
                            if (d.print && typeof d.print.default === 'number') return d.print.default;
                            if (typeof d.prints === 'number') return d.prints;
                            return 0;
                        }

                        const downloadsByDate = new Map();
                        const printsByDate = new Map();

                        // Extract downloads and prints from dateList for each day
                        dateList.forEach(d => {
                            const dateKey = (d.intervalVal || '').replace(/\//g, '-');
                            const dl = Number(extractDownloads(d)) || 0;
                            const pr = Number(extractPrints(d)) || 0;
                            downloadsByDate.set(dateKey, dl);
                            printsByDate.set(dateKey, pr);
                        });

                        const downloadsData = labels.map(l => downloadsByDate.get(l) || 0);
                        const printsData = labels.map(l => printsByDate.get(l) || 0);

                        const datasets = [
                            { label: 'Downloads', data: downloadsData, borderColor: 'rgba(33,150,243,0.9)', backgroundColor: 'rgba(33,150,243,0.2)', fill: false, tension: 0.2 },
                            { label: 'Prints', data: printsData, borderColor: 'rgba(156,39,176,0.9)', backgroundColor: 'rgba(156,39,176,0.2)', fill: false, tension: 0.2 }
                        ];

                        // destroy old global chart if present
                        try { if (window.__mw_global_points_chart && typeof window.__mw_global_points_chart.destroy === 'function') window.__mw_global_points_chart.destroy(); } catch (e) { }
                        const gc = container.querySelector('#mw-global-points-chart');
                        try {
                            window.__mw_global_points_chart = new Chart(gc.getContext('2d'), { type: 'line', data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { display: true }, y: { beginAtZero: true } }, plugins: { legend: { position: 'top' } } } });
                            if (msgEl) msgEl.textContent = '';
                        } catch (e) {
                            if (msgEl) msgEl.textContent = 'Chart error: ' + (e && e.message);
                        }
                    } catch (e) {
                        if (msgEl) msgEl.textContent = 'Error loading global data: ' + (e && e.message ? e.message : e);
                    }
                }

            } catch (e) { /* silent */ }
        })();

        function loadChartLib() {
            return new Promise((resolve, reject) => {
                if (window.Chart) return resolve();
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
                s.async = true;
                s.onload = () => resolve();
                s.onerror = () => reject(new Error('Failed to load Chart.js'));
                document.head.appendChild(s);
            });
        }

        msg.textContent = 'Loading data...';

        loadChartLib()
            .then(() => fetch('https://makerworld.com/api/v1/point-service/point-bill/my?filter=all&limit=10000'))
            .then(resp => {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json();
            })
            .then(json => {
                const hits = Array.isArray(json.hits) ? json.hits.slice() : [];

                if (!hits.length) {
                    msg.textContent = 'No points data available.';
                    return;
                }

                // Ordina per data ascendente
                hits.sort((a, b) => new Date(a.createTime) - new Date(b.createTime));

                // Calcola totali giornalieri separando regular, exclusive e uscite (redeem)
                // NOTE: use UTC date parts for aggregation so grouping is stable across timezones/DST
                const dateMap = new Map();
                // Aggregazione per modelli (titolo -> { totalPoints, lastDate })
                let modelMap = new Map();
                // Per ogni data, mappa titolo -> points ricevuti quel giorno
                let modelDailyMap = new Map();
                hits.forEach(entry => {
                    const d = new Date(entry.createTime);
                    const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
                    const reg = Number(entry.pointChangeRegular) || 0;
                    const exc = Number(entry.pointChangeExclusive) || 0;
                    // track exclusive earns and exclusive redeems separately so we can compute net exclusive
                    if (!dateMap.has(dateKey)) dateMap.set(dateKey, { regular: 0, exclusivePos: 0, exclusiveOut: 0, out: 0 });
                    const obj = dateMap.get(dateKey);
                    // regular points (positive = earn, negative = redeem)
                    if (reg !== 0) {
                        if (reg >= 0) obj.regular += reg; else obj.out += Math.abs(reg);
                    }
                    // exclusive points (positive = earn, negative = redeem)
                    if (exc !== 0) {
                        if (exc >= 0) obj.exclusivePos += exc; else { obj.exclusiveOut += Math.abs(exc); obj.out += Math.abs(exc); }
                    }

                    // --- model aggregation: attempt to extract a model title from known event types
                    try {
                        let title = null;
                        const t = entry.type || '';
                        if (t === 'boost_exchange_point' && entry.extInfoBoostExchangePoint && entry.extInfoBoostExchangePoint.designTitle) {
                            title = String(entry.extInfoBoostExchangePoint.designTitle).trim();
                        } else if (t === 'instance_reward_v2' && entry.instanceRewardV2 && entry.instanceRewardV2.designTitle) {
                            title = String(entry.instanceRewardV2.designTitle).trim();
                        } else if (t === 'design_reward_v2' && entry.designRewardV2 && entry.designRewardV2.title) {
                            title = String(entry.designRewardV2.title).trim();
                        }
                        if (title) {
                            const posReg = (Number(entry.pointChangeRegular) > 0) ? Number(entry.pointChangeRegular) : 0;
                            const posExc = (Number(entry.pointChangeExclusive) > 0) ? Number(entry.pointChangeExclusive) : 0;
                            const pts = Math.round((posReg + posExc) * 100) / 100;
                            if (pts > 0) {
                                if (!modelMap.has(title)) modelMap.set(title, { total: 0, lastDate: null });
                                const m = modelMap.get(title);
                                m.total = Math.round((m.total + pts) * 100) / 100;
                                // hits are sorted ascending, so last assignment will be the most recent date
                                m.lastDate = dateKey;
                                // record daily points per model
                                try {
                                    if (!modelDailyMap.has(dateKey)) modelDailyMap.set(dateKey, new Map());
                                    const dayMap = modelDailyMap.get(dateKey);
                                    dayMap.set(title, Math.round(((dayMap.get(title) || 0) + pts) * 100) / 100);
                                } catch (e) { /* ignore daily map errors */ }
                            }
                        }
                    } catch (e) { /* ignore model extraction errors */ }
                });

                // Ordina le date in ordine ascendente
                let labels = Array.from(dateMap.keys()).sort();
                let dailyRegularValues = labels.map(k => {
                    const v = dateMap.get(k); return v ? Math.round((v.regular || 0) * 100) / 100 : 0;
                });
                // exclusive positive (earned) e exclusive redeemed (out) — later compute net
                let dailyExclusivePosValues = labels.map(k => {
                    const v = dateMap.get(k); return v ? Math.round((v.exclusivePos || 0) * 100) / 100 : 0;
                });
                let dailyExclusiveOutValues = labels.map(k => {
                    const v = dateMap.get(k); return v ? Math.round((v.exclusiveOut || 0) * 100) / 100 : 0;
                });
                let dailyOutValues = labels.map(k => {
                    const v = dateMap.get(k); return v ? Math.round((v.out || 0) * 100) / 100 : 0;
                });

                // Totale 'in' giornaliero (regular + exclusive)
                // daily exclusive net = earned - redeemed (used for predictions)
                let dailyExclusiveValues = labels.map((k, i) => Math.round(((dailyExclusivePosValues[i] || 0) - (dailyExclusiveOutValues[i] || 0)) * 100) / 100);
                // dailyExclusiveEarned shows only positive exclusive earned for visualization (do not show negative exclusive values on chart)
                let dailyExclusiveEarned = labels.map((k, i) => (dailyExclusivePosValues[i] || 0));
                let dailyInValues = labels.map((k, i) => Math.round(((dailyRegularValues[i] || 0) + (dailyExclusiveValues[i] || 0)) * 100) / 100);

                // Valori netti giornalieri (in - out) usati per cumulativo
                let netDailyValues = labels.map((k, i) => Math.round(((dailyInValues[i] || 0) - (dailyOutValues[i] || 0)) * 100) / 100);
                // Cumulativo per data (sommando i net giornalieri)
                let cumulativeValues = [];
                netDailyValues.reduce((acc, cur) => {
                    const next = acc + cur;
                    cumulativeValues.push(Math.round(next * 100) / 100);
                    return next;
                }, 0);

                // Cumulativo delle exclusive net (earned - redeemed) — usato per previsioni in denaro
                let cumulativeExclusiveValues = [];
                dailyExclusiveValues.reduce((acc, cur) => {
                    const next = acc + (cur || 0);
                    cumulativeExclusiveValues.push(Math.round(next * 100) / 100);
                    return next;
                }, 0);

                // Aggregazione mensile (exclusive earned e exclusive redeemed)
                let monthMap = new Map();
                for (let i = 0; i < labels.length; i++) {
                    const d = labels[i]; // YYYY-MM-DD
                    const [y, m] = d.split('-');
                    const monthKey = `${y}-${m}`;
                    const exclusiveEarned = Number(dailyExclusiveEarned[i] || 0);
                    const exclusiveRedeemed = Number(dailyExclusiveOutValues[i] || 0);
                    if (!monthMap.has(monthKey)) monthMap.set(monthKey, { exclusiveEarned: 0, exclusiveRedeemed: 0, days: 0 });
                    const obj = monthMap.get(monthKey);
                    obj.exclusiveEarned += exclusiveEarned;
                    obj.exclusiveRedeemed += exclusiveRedeemed;
                    obj.days += 1;
                }

                // Prepara chiavi ordinate per la tabella mensile
                let monthKeys = Array.from(monthMap.keys()).sort();

                // Funzione che renderizza il riepilogo mensile (solo valori exclusive convertiti in USD)
                function renderMonthlySummary() {
                    try {
                        const statsEl = container.querySelector('#mw-points-monthly-stats');
                        if (!statsEl) return;

                        // Totali e medie (solo exclusive earned considerati per le medie principali)
                        let sumMonthlyExclusiveEarned = 0;
                        let sumDailyExclusiveEarned = 0;
                        monthKeys.forEach(k => { sumMonthlyExclusiveEarned += (monthMap.get(k).exclusiveEarned || 0); });
                        labels.forEach((l, i) => { sumDailyExclusiveEarned += (dailyExclusiveEarned[i] || 0); });

                        const avgExclusivePerMonthPts = monthKeys.length ? (sumMonthlyExclusiveEarned / monthKeys.length) : 0;
                        const avgExclusivePerDayPts = labels.length ? (sumDailyExclusiveEarned / labels.length) : 0;

                        // Valore mese corrente (exclusive earned)
                        const now = new Date();
                        const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
                        const currentMonthObj = monthMap.get(currentMonthKey) || { exclusiveEarned: 0, exclusiveRedeemed: 0, days: 0 };
                        const currentMonthExclusivePts = currentMonthObj.exclusiveEarned || 0;

                        // Converti in USD
                        const currentMonthUsd = currentMonthExclusivePts * POINT_TO_USD;
                        const avgPerMonthUsd = avgExclusivePerMonthPts * POINT_TO_USD;
                        const avgPerDayUsd = avgExclusivePerDayPts * POINT_TO_USD;

                        const lines = [];
                        lines.push(`<div style="font-weight:600;margin-bottom:6px">Monthly summary (exclusive → USD)</div>`);
                        // Total earned so far (all exclusive earned across months)
                        const totalExclusiveEarnedPts = sumMonthlyExclusiveEarned;
                        const totalExclusiveEarnedUsd = totalExclusiveEarnedPts * POINT_TO_USD;
                        lines.push(`<div style="font-size:13px;color:#666;margin-bottom:6px">Total earned so far: <strong>${formatUsd(totalExclusiveEarnedUsd)}</strong></div>`);
                        lines.push(`<div style="font-size:13px;color:#666;margin-bottom:6px">Current month (${currentMonthKey}): <strong>${formatUsd(currentMonthUsd)}</strong></div>`);
                        lines.push(`<div style="font-size:13px;color:#666;margin-bottom:6px">Average per month: <strong>${formatUsd(avgPerMonthUsd)}</strong></div>`);
                        lines.push(`<div style="font-size:13px;color:#666;margin-bottom:6px">Average per day: <strong>${formatUsd(avgPerDayUsd)}</strong></div>`);

                        // Monthly breakdown table (show USD based on exclusive earned and exclusive redeemed)
                        let table = '<div style="max-height:160px;overflow:auto;margin-top:6px;"><table style="width:100%;border-collapse:collapse;font-size:12px">';
                        table += '<tr><th style="text-align:left;padding:4px 6px;border-bottom:1px solid #eee">Month</th><th style="text-align:right;padding:4px 6px;border-bottom:1px solid #eee">Exclusive earned (USD)</th><th style="text-align:right;padding:4px 6px;border-bottom:1px solid #eee">Exclusive redeemed (USD)</th><th style="text-align:right;padding:4px 6px;border-bottom:1px solid #eee">Days</th></tr>';
                        monthKeys.forEach(k => {
                            const o = monthMap.get(k) || { exclusiveEarned: 0, exclusiveRedeemed: 0, days: 0 };
                            const usdEarned = (o.exclusiveEarned || 0) * POINT_TO_USD;
                            const usdRedeemed = (o.exclusiveRedeemed || 0) * POINT_TO_USD;
                            table += `<tr><td style="padding:4px 6px;border-bottom:1px solid #fafafa">${k}</td><td style="padding:4px 6px;text-align:right;border-bottom:1px solid #fafafa">${formatUsd(usdEarned)}</td><td style="padding:4px 6px;text-align:right;border-bottom:1px solid #fafafa">${formatUsd(usdRedeemed)}</td><td style="padding:4px 6px;text-align:right;border-bottom:1px solid #fafafa">${o.days}</td></tr>`;
                        });
                        table += '</table></div>';

                        statsEl.innerHTML = lines.join('') + table;
                    } catch (e) {
                        // silent
                    }
                }

                if (!labels.length) {
                    msg.textContent = 'No aggregated data to display.';
                    return;
                }

                msg.textContent = '';

                const canvas = container.querySelector('#mw-points-chart');
                const ctx = canvas.getContext('2d');

                // Parametri per le previsioni
                const POINT_TO_USD = 0.066;

                // Calcolo media giornaliera (ultimi 30 giorni o tutti se meno) basata solo sugli exclusive
                const windowSize = Math.min(30, dailyExclusiveValues.length);
                const recent = dailyExclusiveValues.slice(-windowSize).filter(x => typeof x === 'number' && !isNaN(x) && x > 0);
                const avgDaily = recent.length ? (recent.reduce((a, b) => a + b, 0) / recent.length) : 0;

                // Preparazione delle previsioni (30 giorni), milestones e selettore valuta
                const predictionsContent = container.querySelector('#mw-points-predictions-content');
                const detailsDiv = container.querySelector('#mw-points-details');
                const toggleBtn = container.querySelector('#mw-points-details-toggle');
                predictionsContent.innerHTML = '';

                // Simplified: no currency conversion — amounts shown in USD
                const CURRENCY_CODE = 'USD';
                const CURRENCY_SYMBOL = '$';
                function formatUsd(usdAmount) {
                    const n = (typeof usdAmount === 'number' && !isNaN(usdAmount)) ? Math.round(usdAmount * 100) / 100 : 0;
                    return CURRENCY_SYMBOL + n.toFixed(2);
                }

                // Render details table (re-usable). This now also contains the
                // per-model breakdown / ranking that was previously shown in
                // the prominent "last info" area. Putting it into Details keeps
                // the main block compact while still exposing full diagnostics.
                function renderDetails() {
                    if (!detailsDiv) return;
                    let table = '<div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px">';
                    table += '<tr><th style="text-align:left;padding:4px 6px;border-bottom:1px solid #eee">Date</th><th style="text-align:right;padding:4px 6px;border-bottom:1px solid #eee">Regular pts</th><th style="text-align:right;padding:4px 6px;border-bottom:1px solid #eee">Exclusive pts</th><th style="text-align:right;padding:4px 6px;border-bottom:1px solid #eee">Out pts</th><th style="text-align:right;padding:4px 6px;border-bottom:1px solid #eee">' + CURRENCY_CODE + ' (exclusive)</th></tr>';
                    for (let i = 0; i < labels.length; i++) {
                        const d = labels[i];
                        const dreg = (dailyRegularValues[i] || 0);
                        const dex = (dailyExclusiveEarned[i] || 0);
                        const dout = (dailyOutValues[i] || 0);
                        const usdExclusive = (dex * POINT_TO_USD) || 0;
                        const localized = formatUsd(usdExclusive);
                        table += `<tr><td style="padding:4px 6px;border-bottom:1px solid #fafafa">${d}</td><td style="padding:4px 6px;text-align:right;border-bottom:1px solid #fafafa">${dreg}</td><td style="padding:4px 6px;text-align:right;border-bottom:1px solid #fafafa">${dex}</td><td style="padding:4px 6px;text-align:right;border-bottom:1px solid #fafafa">${dout}</td><td style="padding:4px 6px;text-align:right;border-bottom:1px solid #fafafa">${localized}</td></tr>`;
                    }
                    table += '</table></div>';

                    // Extra diagnostics moved into Details: last-date model breakdown,
                    // top models and models without recent points.
                    let extra = '<div id="mw-points-details-extra" style="margin-top:10px;padding-top:8px;border-top:1px dashed rgba(0,0,0,0.04);font-size:13px;color:#666">';
                    try {
                        const lastKey = lastDateStr || (labels.length ? labels[labels.length - 1] : null);
                        extra += `<div style="font-weight:600;margin-bottom:6px">Last points breakdown (${lastKey || 'N/A'})</div>`;
                        // breakdown by model on the last date
                        const dayMap = (lastKey && modelDailyMap && modelDailyMap.get(lastKey)) ? modelDailyMap.get(lastKey) : null;
                        if (dayMap && dayMap.size) {
                            extra += '<ul style="margin:0 0 8px 16px;padding:0;color:#222">';
                            Array.from(dayMap.entries()).forEach(([t, pts]) => {
                                extra += `<li style="margin:2px 0">${t}: ${pts} pts</li>`;
                            });
                            extra += '</ul>';
                        } else {
                            extra += '<div style="color:#666;margin-bottom:8px">No model-specific points for the last date.</div>';
                        }

                        // Top models (first 5)
                        if (Array.isArray(modelRanking) && modelRanking.length) {
                            extra += '<div style="font-weight:600;margin-top:6px;margin-bottom:6px">Top models (recent first)</div>';
                            extra += '<ol style="margin:0 0 8px 18px;padding:0;color:#222">';
                            modelRanking.slice(0, 5).forEach(m => {
                                const last = m.lastDate || 'N/A';
                                extra += `<li style="margin:2px 0">${m.title} — ${m.total} pts (last: ${last})</li>`;
                            });
                            extra += '</ol>';
                        }

                        // Models with no points in last 5 days
                        if (Array.isArray(modelsNoPointsLast5) && modelsNoPointsLast5.length) {
                            extra += '<div style="font-weight:600;margin-top:6px;margin-bottom:4px">No points in last 5 days</div>';
                            extra += '<div style="color:#666">' + modelsNoPointsLast5.map(m => m.title).slice(0, 10).join(', ') + '</div>';
                        }
                    } catch (e) {
                        extra += '<div style="color:#666">Error rendering extra details (see console)</div>';
                        console.warn('renderDetails extra error', e);
                    }
                    extra += '</div>';

                    detailsDiv.innerHTML = table + extra;
                }

                // Render predictions (re-usable)
                function renderPredictions() {
                    predictionsContent.innerHTML = '';
                    if (!avgDaily || avgDaily <= 0) {
                        predictionsContent.innerHTML = '<div style="color:#666">Not enough positive activity to produce projections.</div>';
                        return;
                    }
                    const futureDays = 30;
                    const ul = document.createElement('div');
                    ul.style.lineHeight = '1.35';
                    for (let i = 1; i <= futureDays; i++) {
                        const dt = new Date(lastDate);
                        dt.setDate(dt.getDate() + i);
                        const dateLabel = dt.toISOString().split('T')[0];
                        const projPoints = Math.round((lastExclusiveCumulative + avgDaily * i) * 100) / 100;
                        const projUsd = projPoints * POINT_TO_USD;
                        const projLocal = formatUsd(projUsd);
                        const div = document.createElement('div');
                        div.style.marginBottom = '6px';
                        div.innerHTML = `<div style="font-weight:600">${dateLabel}</div><div style="color:#444">${projPoints} pts — ${projLocal}</div>`;
                        ul.appendChild(div);
                    }
                    predictionsContent.appendChild(ul);

                    // Milestones
                    const milestones = [100, 500, 1000, 5000];
                    const msDiv = document.createElement('div');
                    msDiv.style.marginTop = '8px';
                    msDiv.innerHTML = '<div style="font-weight:600;margin-bottom:6px">When will I reach...</div>';
                    milestones.forEach(ms => {
                        const target = lastExclusiveCumulative + ms;
                        // round target to 2 decimals to avoid long float representation
                        const roundedTarget = Math.round(target * 100) / 100;
                        const daysNeeded = Math.max(0, Math.ceil((roundedTarget - lastExclusiveCumulative) / avgDaily));
                        const reachDate = new Date(lastDate);
                        reachDate.setDate(reachDate.getDate() + daysNeeded);
                        const dateLabel = reachDate.toISOString().split('T')[0];
                        const usd = roundedTarget * POINT_TO_USD;
                        const localized = formatUsd(usd);
                        const p = document.createElement('div');
                        p.style.fontSize = '13px';
                        p.style.marginBottom = '4px';
                        const ptsLabel = roundedTarget.toLocaleString(undefined, { maximumFractionDigits: 2 });
                        p.innerHTML = `+${ms} pts → <strong>${ptsLabel} pts</strong> on ${dateLabel} (~${localized})`;
                        msDiv.appendChild(p);
                    });
                    predictionsContent.appendChild(msDiv);
                }

                // Toggle details AND projections together (show both or hide both), and hide title when hidden
                if (toggleBtn) {
                    toggleBtn.addEventListener('click', () => {
                        try {
                            const predsEl = container.querySelector('#mw-points-predictions-content');
                            const titleEl = container.querySelector('#mw-points-predictions-title');
                            const detailsVisible = detailsDiv && (getComputedStyle(detailsDiv).display !== 'none');
                            const predsVisible = predsEl && (getComputedStyle(predsEl).display !== 'none');
                            const currentlyVisible = detailsVisible || predsVisible;
                            const show = !currentlyVisible;
                            if (detailsDiv) detailsDiv.style.display = show ? 'block' : 'none';
                            if (predsEl) predsEl.style.display = show ? 'block' : 'none';
                            if (titleEl) titleEl.style.display = show ? 'block' : 'none';
                        } catch (e) {
                            // ignore
                        }
                    });
                }
                let lastDateStr = labels[labels.length - 1];
                let lastDateParts = lastDateStr.split('-').map(s => parseInt(s, 10));
                // Construct lastDate as UTC midnight for the aggregated UTC date
                let lastDate = new Date(Date.UTC(lastDateParts[0], lastDateParts[1] - 1, lastDateParts[2]));
                let lastCumulative = cumulativeValues[cumulativeValues.length - 1] || 0;
                // Ultima cumulativa degli exclusive (usata per le proiezioni in denaro)
                let lastExclusiveCumulative = (typeof cumulativeExclusiveValues !== 'undefined' && cumulativeExclusiveValues.length) ? cumulativeExclusiveValues[cumulativeExclusiveValues.length - 1] : 0;

                // Build model ranking and identify models without points in the last N days
                // Helper: parse YYYY-MM-DD into a UTC Date at midnight
                function ymdToUtcDate(ymd) {
                    try {
                        const parts = (ymd || '').split('-').map(s => parseInt(s, 10));
                        if (parts.length !== 3 || parts.some(isNaN)) return null;
                        return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
                    } catch (e) { return null; }
                }

                let modelRanking = [];
                let modelsNoPointsLast5 = [];
                try {
                    modelRanking = Array.from(modelMap.entries()).map(([title, obj]) => ({ title, total: obj.total || 0, lastDate: obj.lastDate || null }));
                    // Sort by most recent point (lastDate desc). If equal or missing, fall back to total points desc.
                    modelRanking.sort((a, b) => {
                        try {
                            const da = a.lastDate ? ymdToUtcDate(a.lastDate) : null;
                            const db = b.lastDate ? ymdToUtcDate(b.lastDate) : null;
                            if (da && db) {
                                if (db.getTime() !== da.getTime()) return db.getTime() - da.getTime();
                            } else if (da && !db) {
                                return -1; // a more recent than b
                            } else if (!da && db) {
                                return 1; // b more recent
                            }
                        } catch (e) { /* ignore and fallback */ }
                        return (b.total || 0) - (a.total || 0);
                    });
                    const cutoff = new Date(lastDate.getTime() - (5 * 24 * 3600 * 1000));
                    modelsNoPointsLast5 = modelRanking.filter(m => {
                        if (!m.lastDate) return true;
                        const d = ymdToUtcDate(m.lastDate);
                        if (!d) return true;
                        return d.getTime() <= cutoff.getTime();
                    });
                } catch (e) { /* ignore */ }

                // Render the Goal widget (allows setting a USD goal, shows progress ring and ETA)
                function renderGoalWidget() {
                    try {
                        const el = container.querySelector('#mw-points-goal');
                        if (!el) return;
                        const storageKey = 'mw_points_goal_usd';
                        let goalUsd = Number(localStorage.getItem(storageKey)) || 1000;
                        if (goalUsd <= 0) goalUsd = 1000;

                        const currentUsd = Math.round((lastExclusiveCumulative * POINT_TO_USD) * 100) / 100;
                        const percent = Math.min(1, Math.max(0, (currentUsd / goalUsd) || 0));
                        const percentLabel = Math.round(percent * 100);

                        const goalPts = goalUsd / POINT_TO_USD;
                        let days = null;
                        if (avgDaily > 0) {
                            const remainingPts = Math.max(0, goalPts - lastExclusiveCumulative);
                            days = Math.ceil(remainingPts / (avgDaily || 1));
                        }
                        const etaLabel = (days === null || !isFinite(days)) ? 'N/A' : `${days} day${days !== 1 ? 's' : ''} (~${new Date(lastDate.getTime() + days * 24 * 3600000).toISOString().split('T')[0]})`;

                        const hue = Math.round(percent * 120); // 0 => red, 120 => green
                        const color = `hsl(${hue},80%,45%)`;
                        const size = 64;
                        const stroke = 8;
                        const r = (size - stroke) / 2;
                        const cxy = size / 2;
                        const circumference = 2 * Math.PI * r;
                        const offset = circumference * (1 - percent);

                        // If the input exists and is currently focused, avoid recreating the whole
                        // widget (which would steal the user's typing). Instead, update the
                        // progress visuals/text only and leave the input untouched.
                        const existingInput = el.querySelector('#mw-goal-input');
                        const isEditing = existingInput && document.activeElement === existingInput;
                        if (isEditing) {
                            // update ring, text and ETA if present
                            try {
                                const ring = el.querySelector('#mw-goal-ring');
                                if (ring) ring.setAttribute('stroke-dashoffset', String(offset));
                                const amounts = el.querySelector('#mw-goal-amounts');
                                if (amounts) amounts.textContent = `${formatUsd(currentUsd)} / ${formatUsd(goalUsd)}`;
                                const prog = el.querySelector('#mw-goal-progress-text');
                                if (prog) prog.innerHTML = `Progress: <strong>${percentLabel}%</strong>`;
                                const etaEl = el.querySelector('#mw-goal-eta');
                                if (etaEl) etaEl.textContent = `ETA: ${etaLabel}`;
                            } catch (e) { /* ignore updates */ }
                            return; // don't re-create DOM while user is editing
                        }

                        // Render full widget (safe when user not editing)
                        el.innerHTML = `
                        <div style="display:flex;gap:10px;align-items:center">
                            <svg id="mw-goal-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
                                <circle cx="${cxy}" cy="${cxy}" r="${r}" stroke="#eee" stroke-width="${stroke}" fill="none"/>
                                <circle id="mw-goal-ring" cx="${cxy}" cy="${cxy}" r="${r}" stroke="${color}" stroke-width="${stroke}" fill="none"
                                    stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
                                    transform="rotate(-90 ${cxy} ${cxy})"/>
                            </svg>
                            <div style="flex:1">
                                <div id="mw-goal-amounts" style="font-weight:700">${formatUsd(currentUsd)} / ${formatUsd(goalUsd)}</div>
                                <div id="mw-goal-progress-text" style="font-size:12px;color:#555">Progress: <strong>${percentLabel}%</strong> · <span id="mw-goal-eta">ETA: ${etaLabel}</span></div>
                                <div style="margin-top:6px;display:flex;gap:6px;align-items:center">
                                    <input id="mw-goal-input" type="number" min="1" value="${goalUsd}" style="width:120px;padding:6px;border:1px solid #ddd;border-radius:6px"/>
                                    <button id="mw-goal-save" style="padding:6px 8px;border-radius:6px;background:#1976d2;color:#fff;border:none;cursor:pointer">Save</button>
                                    <button id="mw-goal-clear" style="padding:6px 8px;border-radius:6px;background:#eee;color:#333;border:none;cursor:pointer">Reset</button>
                                </div>
                            </div>
                        </div>
                    `;

                        const input = el.querySelector('#mw-goal-input');
                        const saveBtn = el.querySelector('#mw-goal-save');
                        const clearBtn = el.querySelector('#mw-goal-clear');
                        if (saveBtn) {
                            saveBtn.onclick = () => {
                                const v = Number(input.value) || 0;
                                if (v <= 0) { swal('Error', 'Enter a positive goal', 'error'); return; }
                                localStorage.setItem(storageKey, String(v));
                                // update visuals without forcing focus changes
                                try { renderGoalWidget(); } catch (e) { }
                                try { swal({ title: 'Saved', icon: 'success', buttons: false, timer: 800 }); } catch (e) { }
                            };
                        }
                        if (clearBtn) {
                            clearBtn.onclick = () => {
                                localStorage.removeItem(storageKey);
                                try { renderGoalWidget(); } catch (e) { }
                                try { swal({ title: 'Reset', buttons: false, timer: 800 }); } catch (e) { }
                            };
                        }
                        if (input) {
                            input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveBtn && saveBtn.click(); });
                        }
                    } catch (e) {
                        // silent
                    }
                }

                // Debug panel removed to keep UI clean
                // Render a prominent "last points" info block so the latest activity is clearly visible
                function renderLastInfo() {
                    try {
                        const info = container.querySelector('#mw-points-last-info');
                        if (!info) return;
                        const amountEl = info.querySelector('#mw-points-last-amount');
                        const descEl = info.querySelector('#mw-points-last-desc');
                        const smallEl = info.querySelector('#mw-points-last-small');
                        const idx = labels.length - 1;
                        if (idx < 0) {
                            amountEl.textContent = '0 pts';
                            descEl.textContent = 'No recent activity';
                            return;
                        }
                        const date = labels[idx];
                        const dreg = Number(dailyRegularValues[idx] || 0);
                        const dex = Number(dailyExclusiveEarned[idx] || 0);
                        const dout = Number(dailyOutValues[idx] || 0);
                        // show only positive earned points (regular earned + exclusive earned), do not show negative net
                        const earnedRegular = (dreg && dreg > 0) ? dreg : 0;
                        const earnedExclusive = (dex && dex > 0) ? dex : 0;
                        const earnedTotal = Math.round((earnedRegular + earnedExclusive) * 100) / 100;
                        const usdExclusive = (dex * POINT_TO_USD) || 0;
                        amountEl.textContent = (earnedTotal > 0) ? `+${earnedTotal} pts` : '0 pts';
                        amountEl.style.color = '#0b7a3f';
                        descEl.textContent = `on ${date} — Regular: ${dreg}, Exclusive: ${dex}, Out: ${dout} — ${formatUsd(usdExclusive)}`;
                        smallEl.textContent = 'Exclusive value shown in USD (based on exclusive points earned)';

                        // The detailed per-model breakdown and rankings are now shown
                        // inside the Details panel. Keep the main info block concise.
                        try {
                            const oldRankEl = info.querySelector('#mw-points-top-models');
                            if (oldRankEl) oldRankEl.remove();
                            smallEl.textContent = 'Open "Details" for per-model breakdown and rankings.';
                        } catch (e) { /* ignore */ }
                    } catch (e) {
                        // fail silently
                    }
                }
                // Ensure rates, render details/predictions and create chart (tooltip uses selected currency)
                function createChart() {
                    // create chart and store instance for later updates
                    // Build datasets dynamically so we can hide 'redeemed' when all zeros
                    const datasets = [
                        {
                            label: 'Points regular',
                            data: dailyRegularValues,
                            backgroundColor: 'rgba(63,81,181,0.7)',
                            borderColor: 'rgba(63,81,181,0.95)',
                            borderWidth: 1
                        },
                        {
                            label: 'Points exclusive',
                            data: dailyExclusiveEarned,
                            backgroundColor: 'rgba(30,136,229,0.7)',
                            borderColor: 'rgba(30,136,229,0.95)',
                            borderWidth: 1
                        }
                    ];
                    // Intentionally do NOT display redeemed points to keep chart focused on earnings

                    window.__mw_points_chart = new Chart(ctx, {
                        type: 'bar',
                        data: {
                            labels: labels,
                            datasets: datasets
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            // Interaction default (index/intersect) to preserve original behavior
                            interaction: {
                                mode: 'index',
                                intersect: true
                            },
                            scales: {
                                x: { display: true, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 40 } },
                                y: { display: true, beginAtZero: true }
                            },
                            // use Chart.js defaults for dataset sizing
                            plugins: {
                                legend: { display: true, position: 'top' },
                                tooltip: {
                                    callbacks: {
                                        label: function (context) {
                                            const pts = context.parsed && typeof context.parsed.y === 'number' ? context.parsed.y : (typeof context.parsed === 'number' ? context.parsed : 0);
                                            const datasetLabel = context.dataset.label || '';
                                            const usd = (pts * POINT_TO_USD) || 0;
                                            const localized = formatUsd(usd);
                                            // Only show USD value for exclusive points, not regular points
                                            if (datasetLabel.toLowerCase().includes('regular')) {
                                                return `${datasetLabel}: ${pts} pts`;
                                            }
                                            return `${datasetLabel}: ${pts} pts — ${localized}`;
                                        }
                                    }
                                }
                            }
                        }
                    });
                }

                function updateChartTooltip() {
                    try {
                        const ch = window.__mw_points_chart;
                        if (!ch) return;
                        ch.options.plugins.tooltip.callbacks.label = function (context) {
                            const pts = context.parsed.y;
                            const datasetLabel = context.dataset.label || '';
                            const usd = (pts * POINT_TO_USD) || 0;
                            const localized = formatUsd(usd);
                            // Only show USD value for exclusive points, not regular points
                            if (datasetLabel.toLowerCase().includes('regular')) {
                                return `${datasetLabel}: ${pts} pts`;
                            }
                            return `${datasetLabel}: ${pts} pts — ${localized}`;
                        };
                        ch.update();
                    } catch (e) { }
                }

                // Render last info, details, monthly summary, goal widget, predictions and chart (USD-only, no external rates)
                renderLastInfo();
                renderDetails();
                renderMonthlySummary();
                // Goal widget (shows progress towards a USD target and ETA)
                renderGoalWidget();
                renderPredictions();
                createChart();
                // Giftcard indicator - fetch and display how many giftcards can be purchased
                renderGiftcardsIndicator();

                // Realtime updater (5s) — automatic (no toggle)
                (function setupRealtime() {
                    try {
                        let intervalId = null;
                        const updateIntervalMs = 5000;

                        async function fetchAndUpdate() {
                            try {
                                const r = await fetch('https://makerworld.com/api/v1/point-service/point-bill/my?filter=all&limit=10000');
                                if (!r.ok) return;
                                const j = await r.json();
                                const hits2 = Array.isArray(j.hits) ? j.hits.slice() : [];
                                if (!hits2.length) return;
                                // re-compute aggregations (same logic as initial run)
                                const dmap = new Map();
                                hits2.sort((a, b) => new Date(a.createTime) - new Date(b.createTime));
                                hits2.forEach(entry => {
                                    const d = new Date(entry.createTime);
                                    const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
                                    const reg = Number(entry.pointChangeRegular) || 0;
                                    const exc = Number(entry.pointChangeExclusive) || 0;
                                    if (!dmap.has(dateKey)) dmap.set(dateKey, { regular: 0, exclusivePos: 0, exclusiveOut: 0, out: 0 });
                                    const obj = dmap.get(dateKey);
                                    if (reg !== 0) { if (reg >= 0) obj.regular += reg; else obj.out += Math.abs(reg); }
                                    if (exc !== 0) { if (exc >= 0) obj.exclusivePos += exc; else { obj.exclusiveOut += Math.abs(exc); obj.out += Math.abs(exc); } }
                                });
                                // assign into outer variables
                                labels = Array.from(dmap.keys()).sort();
                                dailyRegularValues = labels.map(k => { const v = dmap.get(k); return v ? Math.round((v.regular || 0) * 100) / 100 : 0; });
                                dailyExclusivePosValues = labels.map(k => { const v = dmap.get(k); return v ? Math.round((v.exclusivePos || 0) * 100) / 100 : 0; });
                                dailyExclusiveOutValues = labels.map(k => { const v = dmap.get(k); return v ? Math.round((v.exclusiveOut || 0) * 100) / 100 : 0; });
                                dailyOutValues = labels.map(k => { const v = dmap.get(k); return v ? Math.round((v.out || 0) * 100) / 100 : 0; });
                                dailyExclusiveValues = labels.map((k, i) => Math.round(((dailyExclusivePosValues[i] || 0) - (dailyExclusiveOutValues[i] || 0)) * 100) / 100);
                                dailyExclusiveEarned = labels.map((k, i) => (dailyExclusivePosValues[i] || 0));
                                dailyInValues = labels.map((k, i) => Math.round(((dailyRegularValues[i] || 0) + (dailyExclusiveValues[i] || 0)) * 100) / 100);
                                netDailyValues = labels.map((k, i) => Math.round(((dailyInValues[i] || 0) - (dailyOutValues[i] || 0)) * 100) / 100);
                                cumulativeValues = []; netDailyValues.reduce((acc, cur) => { const next = acc + cur; cumulativeValues.push(Math.round(next * 100) / 100); return next; }, 0);
                                cumulativeExclusiveValues = []; dailyExclusiveValues.reduce((acc, cur) => { const next = acc + (cur || 0); cumulativeExclusiveValues.push(Math.round(next * 100) / 100); return next; }, 0);
                                monthMap = new Map();
                                for (let i = 0; i < labels.length; i++) {
                                    const d = labels[i]; const [y, m] = d.split('-'); const monthKey = `${y}-${m}`;
                                    const exclusiveEarned = Number(dailyExclusiveEarned[i] || 0);
                                    const exclusiveRedeemed = Number(dailyExclusiveOutValues[i] || 0);
                                    if (!monthMap.has(monthKey)) monthMap.set(monthKey, { exclusiveEarned: 0, exclusiveRedeemed: 0, days: 0 });
                                    const o = monthMap.get(monthKey); o.exclusiveEarned += exclusiveEarned; o.exclusiveRedeemed += exclusiveRedeemed; o.days += 1;
                                }
                                monthKeys = Array.from(monthMap.keys()).sort();

                                // Rebuild modelMap and modelDailyMap from hits2
                                try {
                                    const tempModelMap = new Map();
                                    const tempModelDailyMap = new Map();
                                    hits2.forEach(entry => {
                                        try {
                                            const d = new Date(entry.createTime);
                                            const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
                                            let title = null;
                                            const t = entry.type || '';
                                            if (t === 'boost_exchange_point' && entry.extInfoBoostExchangePoint && entry.extInfoBoostExchangePoint.designTitle) {
                                                title = String(entry.extInfoBoostExchangePoint.designTitle).trim();
                                            } else if (t === 'instance_reward_v2' && entry.instanceRewardV2 && entry.instanceRewardV2.designTitle) {
                                                title = String(entry.instanceRewardV2.designTitle).trim();
                                            } else if (t === 'design_reward_v2' && entry.designRewardV2 && entry.designRewardV2.title) {
                                                title = String(entry.designRewardV2.title).trim();
                                            }
                                            if (title) {
                                                const posReg = (Number(entry.pointChangeRegular) > 0) ? Number(entry.pointChangeRegular) : 0;
                                                const posExc = (Number(entry.pointChangeExclusive) > 0) ? Number(entry.pointChangeExclusive) : 0;
                                                const pts = Math.round((posReg + posExc) * 100) / 100;
                                                if (pts > 0) {
                                                    if (!tempModelMap.has(title)) tempModelMap.set(title, { total: 0, lastDate: null });
                                                    const mm = tempModelMap.get(title);
                                                    mm.total = Math.round((mm.total + pts) * 100) / 100;
                                                    mm.lastDate = dateKey;
                                                    if (!tempModelDailyMap.has(dateKey)) tempModelDailyMap.set(dateKey, new Map());
                                                    const dm = tempModelDailyMap.get(dateKey);
                                                    dm.set(title, Math.round(((dm.get(title) || 0) + pts) * 100) / 100);
                                                }
                                            }
                                        } catch (e) { /* ignore per-entry errors */ }
                                    });
                                    modelMap = tempModelMap;
                                    modelDailyMap = tempModelDailyMap;

                                    // recompute ranking and no-points list using updated labels/lastDate
                                    try {
                                        modelRanking = Array.from(modelMap.entries()).map(([title, obj]) => ({ title, total: obj.total || 0, lastDate: obj.lastDate || null }));
                                        // sort by most recent point (lastDate desc), fallback to total
                                        modelRanking.sort((a, b) => {
                                            try {
                                                const da = a.lastDate ? ymdToUtcDate(a.lastDate) : null;
                                                const db = b.lastDate ? ymdToUtcDate(b.lastDate) : null;
                                                if (da && db) {
                                                    if (db.getTime() !== da.getTime()) return db.getTime() - da.getTime();
                                                } else if (da && !db) return -1; else if (!da && db) return 1;
                                            } catch (e) { }
                                            return (b.total || 0) - (a.total || 0);
                                        });
                                        const newLastDateStr = labels[labels.length - 1];
                                        const newLastDateParts = newLastDateStr.split('-').map(s => parseInt(s, 10));
                                        const newLastDate = new Date(Date.UTC(newLastDateParts[0], newLastDateParts[1] - 1, newLastDateParts[2]));
                                        const cutoff = new Date(newLastDate.getTime() - (5 * 24 * 3600 * 1000));
                                        modelsNoPointsLast5 = modelRanking.filter(m => {
                                            if (!m.lastDate) return true;
                                            const d = ymdToUtcDate(m.lastDate);
                                            if (!d) return true;
                                            return d.getTime() <= cutoff.getTime();
                                        });
                                    } catch (e) { /* ignore ranking recompute errors */ }
                                } catch (e) { console.warn('rebuild modelMap failed', e); }

                                // recompute lastDate and cumulative values used by other widgets
                                try {
                                    lastDateStr = labels[labels.length - 1];
                                    lastDateParts = lastDateStr.split('-').map(s => parseInt(s, 10));
                                    lastDate = new Date(Date.UTC(lastDateParts[0], lastDateParts[1] - 1, lastDateParts[2]));
                                    lastCumulative = cumulativeValues[cumulativeValues.length - 1] || 0;
                                    lastExclusiveCumulative = (typeof cumulativeExclusiveValues !== 'undefined' && cumulativeExclusiveValues.length) ? cumulativeExclusiveValues[cumulativeExclusiveValues.length - 1] : 0;
                                } catch (e) { /* ignore */ }

                                // update chart datasets (assumes dataset ordering: regular, exclusive, maybe redeemed)
                                try {
                                    const ch = window.__mw_points_chart;
                                    if (ch) {
                                        ch.data.labels = labels;
                                        if (Array.isArray(ch.data.datasets) && ch.data.datasets.length >= 2) {
                                            ch.data.datasets[0].data = dailyRegularValues;
                                            ch.data.datasets[1].data = dailyExclusiveEarned;
                                        }
                                        // handle redeemed dataset if present
                                        if (Array.isArray(ch.data.datasets) && ch.data.datasets.length >= 3) {
                                            ch.data.datasets[2].data = dailyOutValues;
                                        }
                                        updateChartTooltip();
                                        try { ch.update(); } catch (e) { }
                                    }
                                } catch (e) { /* ignore chart update errors */ }

                                // refresh UI blocks (update textContent/innerHTML of existing nodes rather than replacing containers)
                                try { renderLastInfo(); } catch (e) { }
                                try { renderDetails(); } catch (e) { }
                                try { renderMonthlySummary(); } catch (e) { }
                                try { renderGoalWidget(); } catch (e) { }
                                try { renderPredictions(); } catch (e) { }
                            } catch (e) {
                                console.warn('realtime update error', e);
                            }
                        }

                        function startRealtime() { if (intervalId) return; intervalId = setInterval(fetchAndUpdate, updateIntervalMs); }
                        function stopRealtime() { if (!intervalId) return; clearInterval(intervalId); intervalId = null; }

                        // start automatic updates (every 5s)
                        try { startRealtime(); } catch (e) { console.warn('startRealtime failed', e); }
                    } catch (e) { }
                })();

                // Chart is created earlier via createChart()
            })
            .catch(err => {
                msg.textContent = 'Error loading chart: ' + (err && err.message ? err.message : err);
            });

    } catch (e) {
        // Non bloccare l'esecuzione
        console.warn('attachPointsChart error', e);
    }
}



// Global variable to track last known market value
window.__mw_last_market = window.__mw_last_market || null;

// Giftcard indicator - shows how many giftcards can be purchased with current points
async function renderGiftcardsIndicator() {
    try {
        const el = document.querySelector('#mw-giftcards-indicator');
        if (!el) return;

        el.innerHTML = '<div style="color:#666">Loading giftcard info...</div>';

        // 1. Get market selector - ALWAYS get fresh value from DOM, not from localStorage
        let market = null;
        try {
            // Try multiple selectors to find the market value
            const selectEl = document.getElementsByClassName("MuiSelect-nativeInput")[0];
            if (selectEl && selectEl.value) {
                market = selectEl.value;
            }

            // Also try to find from the visible MUI select element text
            if (!market) {
                const muiSelect = document.querySelector('.MuiSelect-select');
                if (muiSelect) {
                    const text = muiSelect.textContent?.trim();
                    if (text) {
                        // The text might contain the market name, try to match it
                        const knownMarkets = ['USA', 'EU', 'UK', 'Germany', 'France', 'Italy', 'Spain', 'Japan', 'China', 'Australia', 'Canada', 'Brazil'];
                        for (const m of knownMarkets) {
                            if (text.toLowerCase().includes(m.toLowerCase())) {
                                market = m.toUpperCase();
                                break;
                            }
                        }
                    }
                }
            }

            // Save to localStorage for reference
            if (market) {
                localStorage.setItem('mw_market_selector', market);
            }
        } catch (e) {
            console.warn('Error reading market from DOM:', e);
        }

        // POLLING: Check for market changes periodically
        // This is more reliable than event listeners for MUI components
        function checkMarketChange() {
            try {
                const selectEl = document.getElementsByClassName("MuiSelect-nativeInput")[0];
                if (selectEl && selectEl.value) {
                    const currentMarket = selectEl.value;
                    if (currentMarket !== window.__mw_last_market) {
                        window.__mw_last_market = currentMarket;
                        localStorage.setItem('mw_market_selector', currentMarket);
                        console.log('Market changed to:', currentMarket);
                        renderGiftcardsIndicator();
                    }
                }
            } catch (e) {
                // ignore polling errors
            }
        }

        // Start polling if not already started
        if (!window.__mw_market_polling_started) {
            window.__mw_market_polling_started = true;
            // Poll every 1 second for market changes
            setInterval(checkMarketChange, 1000);
        }

        // Also set up click listeners on the page to detect market selection
        function setupMarketClickListener() {
            try {
                // Listen to clicks on the entire document and check if it might be a market select
                document.addEventListener('click', function (e) {
                    const target = e.target;
                    // Check if click is near a MUI select element
                    if (target.closest('.MuiSelect-select') || target.closest('.MuiSelect-nativeInput')) {
                        // Wait for the menu to open and value to change
                        setTimeout(checkMarketChange, 500);
                    }
                }, true);
            } catch (e) {
                // ignore
            }
        }

        if (!window.__mw_market_click_listener_setup) {
            window.__mw_market_click_listener_setup = true;
            setupMarketClickListener();
        }

        if (!market) {
            el.innerHTML = '<div style="color:#666">Market not detected. Visit makerworld.com to select your market.</div>';
            return;
        }

        // 2. Fetch giftcard data from API
        const apiUrl = `https://makerworld.com/api/v1/point-service/product/products?shop=${encodeURIComponent(market)}`;
        let price = null;
        let giftcardValue = null;
        let currency = null;

        try {
            const resp = await fetch(apiUrl, { credentials: 'same-origin' });
            if (resp.ok) {
                const json = await resp.json();
                const hits = json && json.hits;
                if (Array.isArray(hits)) {
                    // Filter valid giftcards and sort by price ascending to get the base/cheapest one
                    const giftCards = hits.filter(el => el.title && el.title.includes("Gift Card for") && Number(el.price) > 0);
                    if (giftCards.length > 0) {
                        giftCards.sort((a, b) => Number(a.price) - Number(b.price));
                        const gc = giftCards[0];
                        price = Number(gc.price) || null;
                        if (gc.selfBuiltGiftcard || gc.giftcard) {
                            giftcardValue = Number(gc.selfBuiltGiftcard && gc.selfBuiltGiftcard.value) || Number(gc.giftcard && gc.giftcard.value) || null;
                            currency = gc.selfBuiltGiftcard && gc.selfBuiltGiftcard.shop.currency || gc.giftcard && gc.giftcard.shop.currency || null;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Giftcard API error', e);
        }

        if (!price || !giftcardValue || !currency) {
            el.innerHTML = '<div style="color:#666">Giftcard info not available</div>';
            return;
        }

        // 3. Fetch total points from points.json
        let totalPoints = null;
        try {
            // Find buildManifest id
            const byBuild = Array.from(document.querySelectorAll('script[src]')).filter(s => (s.src || '').includes('buildManifest'));
            let buildId = null;
            if (byBuild.length) {
                buildId = byBuild[0].src.split('/')[5] || null;
            }
            if (!buildId) {
                const allScripts = Array.from(document.querySelectorAll('script[src]'));
                for (const s of allScripts) {
                    try {
                        const m = s.src.match(/_next\/static\/([^\/]+)\//);
                        if (m && m[1]) {
                            buildId = m[1];
                            break;
                        }
                    } catch (e) { }
                }
            }

            if (buildId) {
                const pointsUrl = `https://makerworld.com/_next/data/${buildId}/en/points.json`;
                const pointsResp = await fetch(pointsUrl, { credentials: 'same-origin' });
                if (pointsResp.ok) {
                    const pointsJson = await pointsResp.json();
                    const pInfo = pointsJson && pointsJson.pageProps && pointsJson.pageProps.pointInfo;
                    if (pInfo) {
                        // Prioritize current balance (point / availablePoint) over lifetime total (totalPoint)
                        totalPoints = Number(pInfo.point) || Number(pInfo.availablePoint) || Number(pInfo.totalPoint);
                    }
                }
            }
        } catch (e) {
            console.warn('Total points fetch error', e);
        }

        if (totalPoints === null || totalPoints === undefined) {
            el.innerHTML = '<div style="color:#666">Total points not available</div>';
            return;
        }

        // 4. Calculate number of purchasable giftcards (integer part)
        const numGiftcards = Math.floor(totalPoints / price);

        // 5. Format currency symbol
        const currencySymbols = {
            'USD': '$',
            'EUR': '€',
            'GBP': '£',
            'CNY': '¥',
            'JPY': '¥',
            'AUD': 'A$',
            'CAD': 'C$',
            'INR': '₹',
            'KRW': '₩',
            'RUB': '₽',
            'BRL': 'R$',
            'MXN': 'Mex$'
        };
        const currencySymbol = currencySymbols[currency] || currency;

        const totalValue = giftcardValue * numGiftcards;

        // 6. Render the indicator with consistent styling
        el.innerHTML = `
            <div style="display:flex;gap:10px;align-items:center;margin-top:8px;padding:10px;border-radius:8px;background:linear-gradient(90deg,#fff8e1,#fff3c4);box-shadow:0 1px 4px rgba(255,193,7,0.2);">
                <div style="font-size:24px;">🎁</div>
                <div style="flex:1">
                    <div style="font-weight:700;font-size:16px;color:#f57c00">
                        <span style="color:#e65100">${numGiftcards}</span> Gift Card${numGiftcards !== 1 ? 's' : ''}
                        ${numGiftcards > 0 ? `<span style="font-size:12px;color:#666;font-weight:400"> · ${(price - (totalPoints % price)).toLocaleString()} pts to next</span>` : ''}
                    </div>
                    <div style="font-size:12px;color:#666">
                        Total = ${totalValue} ${currencySymbol} · Card = ${price.toLocaleString()} pts
                    </div>
                </div>
            </div>
        `;

    } catch (e) {
        console.warn('renderGiftcardsIndicator error', e);
    }
}

// Funzione che attacca entrambi i listener
function attachAllListeners() {
    attachRecuperaTagsListener();
    attachInserisciTagsListener();
    attachPointsChart(); // inserisce il grafico dei punti se siamo su /en/points
    attachProfileCounts(); // insert downloads/prints on profile pages
}

// Prova ad attaccare subito, poi ogni volta che cambia il DOM
attachAllListeners();

const observer = new MutationObserver(attachAllListeners);
observer.observe(document.body, { childList: true, subtree: true });

// Insert Downloads/Prints counts on public profile pages under #userInfo_wrap
function getBuildIdFromScripts() {
    try {
        // look for buildManifest script first
        const byBuild = Array.from(document.querySelectorAll('script[src]')).filter(s => (s.src || '').includes('buildManifest'));
        if (byBuild.length) {
            const id = byBuild[0].src.split('/')[5] || null;
            if (id) return id;
        }
        const allScripts = Array.from(document.querySelectorAll('script[src]'));
        for (const s of allScripts) {
            try {
                const m = s.src.match(/_next\/static\/([^\/]+)\//);
                if (m && m[1]) return m[1];
            } catch (e) { }
        }
        return localStorage.getItem('mw_build_manifest_id') || null;
    } catch (e) { return localStorage.getItem('mw_build_manifest_id') || null; }
}

function attachProfileCounts() {
    try {
        if (!location.pathname || !location.pathname.startsWith('/en/@')) return;
        const wrap = document.getElementById('userInfo_wrap');
        if (!wrap) return;
        // avoid duplicate runs: check a dataset flag or existing node
        if (wrap.dataset.mwProfileInserted === '1' || wrap.querySelector('#mw-profile-counts')) return;
        // mark as loading so concurrent observers don't trigger multiple fetches
        if (wrap.dataset.mwProfileLoading === '1') return;
        wrap.dataset.mwProfileLoading = '1';

        const id = getBuildIdFromScripts();
        if (!id) { wrap.dataset.mwProfileLoading = ''; return; }
        const url = `https://makerworld.com/_next/data/${id}/en.json`;
        fetch(url, { credentials: 'same-origin' }).then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(j => {
            try {
                // use direct path: j.pageProps.session.user (site exposes pageProps at root)
                const pageProps = (j && j.pageProps) ? j.pageProps : null;
                if (!pageProps) {
                    console.warn('attachProfileCounts: j.pageProps missing in _next data');
                    wrap.dataset.mwProfileLoading = '';
                    return;
                }
                const session = pageProps.session || null;
                const user = session ? session.user : null;

                // extract handle from URL and from JSON to ensure it's the user's personal page
                const path = location.pathname || '';
                const match = path.match(/^\/en\/@([^\/]+)/);
                const handleFromUrl = match ? decodeURIComponent(match[1]) : null;

                let handleFromJson = null;
                if (user) {
                    handleFromJson = user.handle || user.username || user.name || null;
                }

                if (!handleFromUrl || !handleFromJson || String(handleFromUrl).toLowerCase() !== String(handleFromJson).toLowerCase()) {
                    // not the owner's profile; clear loading flag and exit
                    wrap.dataset.mwProfileLoading = '';
                    return;
                }

                const mwc = user && user.MWCount ? user.MWCount : null;
                const prints = (mwc && (typeof mwc.myDesignPrintCount === 'number')) ? mwc.myDesignPrintCount : null;
                const downloads = (mwc && (typeof mwc.myDesignDownloadCount === 'number')) ? mwc.myDesignDownloadCount : null;
                const node = document.createElement('div');
                node.id = 'mw-profile-counts';
                node.style.fontSize = '13px';
                node.style.color = '#333';
                node.style.marginTop = '6px';
                node.innerHTML = `<div style="display:flex;gap:12px;align-items:center"><div><strong>Downloads:</strong> ${downloads !== null ? downloads : 'N/A'}</div><div><strong>Prints:</strong> ${prints !== null ? prints : 'N/A'}</div></div>`;
                const first = wrap.firstElementChild;
                if (first && first.parentNode) first.parentNode.insertBefore(node, first.nextSibling);
                else wrap.appendChild(node);
                // mark inserted and clear loading
                wrap.dataset.mwProfileInserted = '1';
                wrap.dataset.mwProfileLoading = '';
            } catch (e) { console.warn('attachProfileCounts parse error', e); wrap.dataset.mwProfileLoading = ''; }
        }).catch(err => { wrap.dataset.mwProfileLoading = ''; /* ignore network errors silently */ });
    } catch (e) { /* ignore */ }
}

// Watch SPA navigation and remove/recreate chart when route changes
(function () {
    let lastHref = location.href;

    function removeChartIfNeeded() {
        const isPoints = location.href.includes('/en/points');
        if (!isPoints) {
            const container = document.getElementById('mw-points-chart-container');
            if (container) {
                try {
                    if (window.__mw_points_chart && typeof window.__mw_points_chart.destroy === 'function') {
                        window.__mw_points_chart.destroy();
                    }
                } catch (e) { /* ignore */ }
                try { container.remove(); } catch (e) { /* ignore */ }
                pointsChartLoaded = false;
            }
        } else {
            // If we navigated back to points, attempt to re-attach
            try { attachPointsChart(); } catch (e) { /* ignore */ }
        }
    }

    // Intercept history changes so SPA navigations emit an event
    const _push = history.pushState;
    history.pushState = function () {
        const res = _push.apply(this, arguments);
        window.dispatchEvent(new Event('locationchange'));
        return res;
    };
    const _replace = history.replaceState;
    history.replaceState = function () {
        const res = _replace.apply(this, arguments);
        window.dispatchEvent(new Event('locationchange'));
        return res;
    };
    window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));

    window.addEventListener('locationchange', () => {
        if (location.href === lastHref) return;
        lastHref = location.href;
        // small timeout to allow DOM updates
        setTimeout(removeChartIfNeeded, 50);
    });

    // initial check
    setTimeout(removeChartIfNeeded, 100);
})();


async function confirmAndInsert(textArray) {
    swal({
        title: "Confirm tag insertion",
        content: {
            element: "div",
            attributes: {
                innerHTML: `<div style="max-height:200px;overflow:auto;text-align:left;font-size:14px;">
                    ${textArray.map(tag => `<div>${tag}</div>`).join("")}
                </div>`
            }
        },
        buttons: {
            cancel: "Cancel",
            confirm: {
                text: "Insert",
                value: true,
                visible: true,
                className: "",
                closeModal: true
            }
        }
    }).then(async (willInsert) => {
        if (willInsert) {
            try {
                await insertTags(textArray);
                removeUploadingBackdrop();
                swal("Done!", "Tags will be inserted automatically", "success", {
                    buttons: false,
                    timer: 1000
                });
            } catch (e) {
                console.warn('insertTags failed', e);
                swal("Error", "Failed to insert tags", "error");
            }
        } else {
            swal("Operation cancelled", "", "info", {
                buttons: false,
                timer: 1000
            });
        }
    });
}

function removeUploadingBackdrop() {
    try {
        const elements = document.querySelectorAll('div.MuiBackdrop-root');
        const target = Array.from(elements).find(el => (el.textContent || '').toLowerCase().includes('uploading'));
        if (target && target.parentNode) target.parentNode.removeChild(target);
    } catch (e) { /* ignore */ }
}

function insertTags(tags) {
    return new Promise((resolve, reject) => {

        function triggerInputEvent(input, value) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(input, value);

            input.dispatchEvent(new Event('input', {
                bubbles: true
            }));
        }

        const inputSelector = 'input.MuiAutocomplete-input';
        const input = document.querySelectorAll(inputSelector)[1];
        if (!input) {
            console.warn("Campo input non trovato.");
            return;
        }

        let index = 0;

        function typeNextTag() {
            if (index >= tags.length) {
                // give UI a short moment to finalize and then resolve
                setTimeout(() => {
                    try { removeUploadingBackdrop(); } catch (e) { }
                    resolve();
                }, 200);
                return;
            }

            const tag = tags[index];
            input.focus();
            triggerInputEvent(input, tag);

            // Simula pressione di "Enter"
            input.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                bubbles: true
            }));
            input.dispatchEvent(new KeyboardEvent('keyup', {
                key: 'Enter',
                code: 'Enter',
                bubbles: true
            }));

            index++;
            setTimeout(typeNextTag, 50); // tempo per React per aggiornare lo stato
        }

        typeNextTag();
    });
}