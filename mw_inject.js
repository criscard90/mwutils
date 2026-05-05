function InjectSource(sources) {
        
        var injected = Array.from(window.document.scripts).find(function (elem) { 
            return  elem.src.indexOf("mw_injected.js") > -1
        });
        
        if (injected != undefined) {
            return;
        }
        
        body = window.top.document.querySelector('body[scroll=no]') || window.top.document.querySelector('body');
        
        
        if(body){
            sources.forEach(function (s) {
                body.insertAdjacentElement("afterend",s);
            });
        }
    }
    
    function BuildScriptTag(source) {
        var script = document.createElement("script");
        script.setAttribute('type', 'text/javascript');
        script.setAttribute('src', source);
        
        return script;
    }
    
    function BuildStyleTag(source) {
        var style = document.createElement('link');
        style.setAttribute('rel', 'stylesheet');
        style.setAttribute('type', 'text/css');
        style.setAttribute('src', source);
        
        return style;
    }
    
    function injectButtons() {
        if (!chrome.runtime || !chrome.runtime.id) {
            return;
        }
        var form = chrome.runtime.getURL("index.html");
        var xmlHttp = new XMLHttpRequest();
        xmlHttp.open("GET", form, true);
        
        xmlHttp.onreadystatechange = function () {
            if (xmlHttp.readyState == XMLHttpRequest.DONE) {
                if (xmlHttp.status == 200) {
                    var tempDiv = document.createElement("div");
                    tempDiv.innerHTML = xmlHttp.responseText;
                    
                    var buttonRecuperaTags = tempDiv.querySelector("#recuperaTags");
                    var buttonInserisciTags = tempDiv.querySelector("#inserisciTags");
                    var buyMeCoffeeDiv = tempDiv.querySelector("#buyMeCoffeeDiv");

                    var anchor1 = document.querySelector('[class ^= "tab-anchor"]');
                    if (anchor1 && buttonRecuperaTags && !anchor1.querySelector("#recuperaTags")) {
                        anchor1.insertAdjacentElement("beforeend", buttonRecuperaTags);
                    }

                    var anchor2 = document.querySelector('[class ^= "modelTags js-scroll-tags"]');
                    if (anchor2 && buttonInserisciTags && !anchor2.querySelector("#inserisciTags")) {
                        anchor2.insertAdjacentElement("beforeend", buttonInserisciTags);
                    }
                        
                    // Inserisci il pulsante Buy Me a Coffee dopo i bottoni, ad esempio dopo anchor2
                    if (anchor1 && buyMeCoffeeDiv && !anchor1.querySelector("#buyMeCoffeeDiv")) {
                        anchor1.insertAdjacentElement("beforeend", buyMeCoffeeDiv);
                    }
                    
                    // Inserisci il pulsante Buy Me a Coffee dopo i bottoni, ad esempio dopo anchor2
                    if (anchor2 && buyMeCoffeeDiv && !anchor2.querySelector("#buyMeCoffeeDiv")) {
                        anchor2.insertAdjacentElement("beforeend", buyMeCoffeeDiv);
                    }
                    
                    var script = BuildScriptTag(chrome.runtime.getURL("mw_injected.js"));
                    var swal = BuildScriptTag(chrome.runtime.getURL("swal.js"));
                    
                    InjectSource([script, swal]);
                }
            }
        };
        
        xmlHttp.send();
    }
    
    // Esegui subito l'inject
        injectButtons();    
    
    // Osserva i cambiamenti nel DOM per reiniettare i bottoni se necessario
    const observer = new MutationObserver(() => {
        injectButtons();
    });
    
    observer.observe(document.body, { childList: true, subtree: true });

