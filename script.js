
const ukraineBounds = [
    [43.0, 21.0], 
    [53.0, 41.5]
];

const map = L.map('map', {
    zoomControl: false,
    maxBounds: ukraineBounds,
    maxBoundsViscosity: 1.0, 
    minZoom: 5, 
    maxZoom: 8,
    bounceAtZoomLimits: false
}).setView([48.4, 31.2], 6);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '',
    crossOrigin: true
}).addTo(map);

let ukrainePolygons = []; 

// Загрузка геометрии Украины
fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries/UKR.geo.json')
.then(r => r.json())
.then(data => {
    const worldOuter = [
        [-90, -180],
        [90, -180],
        [90, 180],
        [-90, 180],
        [-90, -180]
    ];

    function parseGeometry(geometry) {
        let polygons = [];
        if (geometry.type === 'Polygon') {
            polygons.push(geometry.coordinates[0].map(c => [c[1], c[0]]));
        } else if (geometry.type === 'MultiPolygon') {
            geometry.coordinates.forEach(poly => {
                polygons.push(poly[0].map(c => [c[1], c[0]]));
            });
        }
        return polygons;
    }

    ukrainePolygons = parseGeometry(data.features[0].geometry);
    const maskArray = [worldOuter, ...ukrainePolygons];

    L.polygon(maskArray, {
        color: 'none',
        fillColor: '#05070c', 
        fillOpacity: 1,       
        interactive: false,
        pane: 'overlayPane'
    }).addTo(map);

    L.geoJSON(data, {
        style: {
            color: 'rgba(77, 163, 255, 0.4)',
            weight: 1.5,
            fillOpacity: 0,
            interactive: false
        }
    }).addTo(map);
    
    window.ukraineLayer = true;
    map.invalidateSize();
});

/* ================= RAY-CASTING ALGORITHM ================= */
function isPointInUkraine(lat, lng) {
    if (ukrainePolygons.length === 0) return false;
    
    let inside = false;
    for (let i = 0; i < ukrainePolygons.length; i++) {
        let polygon = ukrainePolygons[i];
        let j = polygon.length - 1;
        for (let k = 0; k < polygon.length; k++) {
            let pi = polygon[k];
            let pj = polygon[j];
            
            if (((pi[0] > lat) !== (pj[0] > lat)) &&
                (lng < (pj[1] - pi[1]) * (lat - pi[0]) / (pj[0] - pi[0]) + pi[1])) {
                inside = !inside;
            }
            j = k;
        }
        if (inside) return true; 
    }
    return inside;
}

/* ================= STATE ================= */
let drones = [];
let pvos = [];
let placing = false;
let activePVO = null;
let selectedIcon = null;
let manualMode = false;

/* ================= AUDIO SYSTEM ================= */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audio = null;

function initAudio() {
    if (!audio) {
        audio = new AudioCtx();
    }
    if (audio.state === 'suspended') {
        audio.resume();
    }
}

function synthSound(freqs, duration, type = "sine", gainVal = 0.05) {
    if (!audio) return;
    try {
        let osc = audio.createOscillator();
        let gainNode = audio.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(freqs[0], audio.currentTime);
        if (freqs.length > 1) {
            osc.frequency.exponentialRampToValueAtTime(freqs[1], audio.currentTime + duration);
        }
        
        gainNode.gain.setValueAtTime(gainVal, audio.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.001, audio.currentTime + duration);
        
        osc.connect(gainNode);
        gainNode.connect(audio.destination);
        
        osc.start();
        osc.stop(audio.currentTime + duration);
    } catch(e) {}
}

function launchSound() {
    synthSound([140, 400], 0.25, "sawtooth", 0.04);
}

function hitSound() {
    synthSound([90, 10], 0.4, "triangle", 0.15);
    setTimeout(() => {
        synthSound([50, 5], 0.5, "sawtooth", 0.1);
    }, 50);
}

function cityDamageSound() {
    synthSound([120, 20], 0.6, "sawtooth", 0.25);
    setTimeout(() => {
        synthSound([70, 10], 0.4, "triangle", 0.2);
    }, 100);
}

/* ================= SHAKE CAMERA (FIXED POSITION) ================= */
function shake(intensity = 3) {
    const mapEl = document.getElementById("map");
    if (!mapEl) return;

    let count = 0;
    const maxSteps = 10;
    let currentIntensity = intensity;

    let interval = setInterval(() => {
        let dx = (Math.random() - 0.5) * currentIntensity;
        let dy = (Math.random() - 0.5) * currentIntensity;
        
        mapEl.style.transform = `translate(${dx}px, ${dy}px)`;
        
        currentIntensity *= 0.8; // Плавное затухание
        count++;

        if (count > maxSteps) {
            clearInterval(interval);
            mapEl.style.transform = ""; 
        }
    }, 25);
}

/* ================= КРАСИВЫЙ СЛОЖНЫЙ ВИБУХ ================= */
function createExplosion(x, y, type = "air") {
    // Теперь передаем уменьшенные параметры для мягкой тряски
    shake(type === "city" ? 5 : 2);
    if (type === "city") {
        cityDamageSound();
    } else {
        hitSound();
    }

    const pCount = type === "city" ? 35 : 22;
    const colors = type === "city" 
        ? ["#ff3300", "#ff6600", "#ffaa00", "#777", "#333"] 
        : ["#ffcc44", "#ff5511", "#ffaa66", "#ffffff"];

    for (let i = 0; i < pCount; i++) {
        let p = document.createElement("div");
        p.className = "explosion-particle";
        
        let size = Math.random() * (type === "city" ? 8 : 5) + 3;
        p.style.width = size + "px";
        p.style.height = size + "px";
        
        let color = colors[Math.floor(Math.random() * colors.length)];
        p.style.background = color;
        p.style.boxShadow = `0 0 ${size * 2}px ${color}`;
        
        p.style.left = x + "px";
        p.style.top = y + "px";
        
        document.body.appendChild(p);
        
        let angle = Math.random() * Math.PI * 2;
        let force = Math.random() * (type === "city" ? 160 : 100) + 20;
        let dx = Math.cos(angle) * force;
        let dy = Math.sin(angle) * force;
        
        p.animate([
            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.1)`, opacity: 0 }
        ], {
            duration: Math.random() * 400 + 400,
            easing: 'cubic-bezier(0.1, 0.8, 0.3, 1)',
            fill: 'forwards'
        });
        
        setTimeout(() => p.remove(), 850);
    }
}

function getRandomTarget() {
    const targets = [
        { lat: 50.45, lng: 30.52 }, 
        { lat: 49.84, lng: 24.03 }, 
        { lat: 48.46, lng: 35.04 }, 
        { lat: 46.48, lng: 30.73 }, 
        { lat: 49.99, lng: 36.23 }, 
        { lat: 47.84, lng: 35.13 },
        { lat: 46.97, lng: 32.00 }  
    ];
    return targets[Math.floor(Math.random() * targets.length)];
}

/* ================= SPAWN ENEMIES ================= */
function spawnDrone() {
    if (!window.ukraineLayer || drones.length > 25) return;

    let side = Math.floor(Math.random() * 3);
    let lat, lng;

    if (side === 0) { 
        lat = 52.3; 
        lng = 28 + Math.random() * 10; 
    } else if (side === 1) { 
        lat = 46 + Math.random() * 5; 
        lng = 40.2; 
    } else { 
        lat = 44.6; 
        lng = 33 + Math.random() * 5; 
    }

    let target = getRandomTarget();
    let angle = Math.atan2(target.lng - lng, target.lat - lat);
    let speed = 0.0035 + Math.random() * 0.0015;

    let d = {
        lat, lng,
        targetLat: target.lat,
        targetLng: target.lng,
        speed, angle,
        alive: true,
        locked: false,
        isRocket: false
    };

    let marker = L.marker([lat, lng], {
        icon: L.divIcon({
            className: "",
            html: `<img src="icons/shahed.png" style="width:16px; height:16px; transform:rotate(${angle * 57.2958}deg); filter:drop-shadow(0 0 5px red);">`,
            iconSize: [16,16],
            iconAnchor: [8,8]
        })
    }).addTo(map);

    d.marker = marker;
    drones.push(d);
    bindDrone(d);
}

function spawnBallisticMissile() {
    if (!window.ukraineLayer) return;
    
    let count = Math.floor(Math.random() * 2) + 2; 
    
    for(let k = 0; k < count; k++) {
        let side = Math.floor(Math.random() * 2);
        let lat, lng;

        if (side === 0) { lat = 52.6; lng = 33 + Math.random() * 5; } 
        else { lat = 47 + Math.random() * 3; lng = 40.5; }

        let target = getRandomTarget();
        let angle = Math.atan2(target.lng - lng, target.lat - lat);
        let speed = 0.038 + Math.random() * 0.012; 

        let d = {
            lat, lng,
            targetLat: target.lat,
            targetLng: target.lng,
            speed, angle,
            alive: true,
            locked: false,
            isRocket: true
        };

        let marker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: "",
                html: `<img src="icons/ballistic1.png" style="width:22px; height:22px; transform:rotate(${angle * 57.2958 + 180}deg); filter:drop-shadow(0 0 8px #ff2222) brightness(1.3);">`,
                iconSize: [22,22],
                iconAnchor: [11,11]
            })
        }).addTo(map);

        d.marker = marker;
        drones.push(d);
        bindDrone(d);
    }
}

setInterval(spawnDrone, 1500);

setTimeout(() => {
    let alertEl = document.getElementById("missileAlert");
    if(alertEl) alertEl.style.display = "flex";
    
    synthSound([300, 300], 0.5, "sawtooth", 0.08);
    setTimeout(() => synthSound([300, 300], 0.5, "sawtooth", 0.08), 600);

    spawnBallisticMissile();
    setInterval(spawnBallisticMissile, 35000);
}, 25000);

/* ================= SCREEN INTERACTION ================= */
function showScreen(screen) {
    const mapBtn = document.getElementById("btnMap");
    const infoBtn = document.getElementById("btnInfo");
    const infoScreen = document.getElementById("infoScreen");

    if (screen === 'map') {
        mapBtn.classList.add("active");
        infoBtn.classList.remove("active");
        infoScreen.style.display = "none";
        setTimeout(() => { 
            map.invalidateSize(); 
        }, 50);
    } else if (screen === 'info') {
        infoBtn.classList.add("active");
        mapBtn.classList.remove("active");
        infoScreen.style.display = "flex";
        initAudio();
    }
}

function selectPVO(card, icon){
    document.querySelectorAll(".card").forEach(c => c.classList.remove("pvo-active"));
    card.classList.add("pvo-active");
    
    setTimeout(() => {
        document.querySelectorAll(".card").forEach(c => c.classList.remove("pvo-active"));
    }, 1500);

    selectedIcon = icon;
    placing = true;
    initAudio();
}

/* ================= PLACE PVO ================= */
map.on('click', e => {
    initAudio();

    if(placing){
        if (!isPointInUkraine(e.latlng.lat, e.latlng.lng)) {
            synthSound([180, 100], 0.15, "triangle", 0.08);
            placing = false;
            return;
        }
        
        let marker = L.marker(e.latlng, {
            icon: L.divIcon({
                className: "",
                html: `<img src="${selectedIcon}" style="width:42px; filter:drop-shadow(0 0 10px #4da3ff);">`
            })
        }).addTo(map);

        let circle = L.circle(e.latlng, {
            radius: 95000,
            color: "#3f8cff",
            weight: 1,
            fillColor: "#3f8cff",
            fillOpacity: 0.06
        }).addTo(map);

        let p = {
            marker, circle,
            latlng: e.latlng,
            icon: selectedIcon,
            auto: false,
            ammo: 10,
            reloading: false
        };

        marker.on('click', (ev) => {
            L.DomEvent.stopPropagation(ev);
            setActivePVO(p);
        });

        circle.on('click', (ev) => {
            L.DomEvent.stopPropagation(ev);
            setActivePVO(p);
        });

        pvos.push(p);
        placing = false;
        return;
    }

    if(manualMode && activePVO){
        let target = findDroneNear(e.latlng);
        if(target){
            let currentDist = map.distance(activePVO.latlng, [target.lat, target.lng]);
            if (currentDist <= 95000) {
                fire(activePVO, target);
            }
        }
    }
});

function updateMiniPanelUI() {
    if(!activePVO) return;
    
    const btnAuto = document.getElementById("miniBtnAuto");
    const btnManual = document.getElementById("miniBtnManual");
    const ammoText = document.getElementById("miniAmmoText");
    
    if(ammoText) ammoText.innerText = `🚀 ${activePVO.ammo}/10`;
    
    if(btnAuto && btnManual) {
        if(activePVO.auto) {
            btnAuto.classList.add("active-auto");
            btnManual.classList.remove("active-manual");
        } else if(manualMode) {
            btnManual.classList.add("active-manual");
            btnAuto.classList.remove("active-auto");
        } else {
            btnAuto.classList.remove("active-auto");
            btnManual.classList.remove("active-manual");
        }
    }
}

function setActivePVO(p){
    activePVO = p;
    pvos.forEach(x => {
        if(x.marker.getElement()) x.marker.getElement().classList.remove("pvo-active");
        x.circle.setStyle({ color: "#3f8cff", fillColor: "#3f8cff", fillOpacity: 0.06 });
    });

    if(p.marker.getElement()) p.marker.getElement().classList.add("pvo-active");
    p.circle.setStyle({ color: "#268644", fillColor: "#268644", fillOpacity: 0.14 });

    let side = document.getElementById("side");
    side.style.display = "block";
    side.innerHTML = `
    <div class="pvo-mini-container">
        <div class="pvo-mini-left">
            <img src="${p.icon}">
            <div class="pvo-mini-title">СИСТЕМА ПВО</div>
        </div>
        <div class="pvo-mini-center">
            <button id="miniBtnAuto" onclick="toggleAuto()" class="mini-toggle-btn">АВТО [C]</button>
            <button id="miniBtnManual" onclick="toggleManual()" class="mini-toggle-btn">РУЧНИЙ [E]</button>
        </div>
        <div class="pvo-mini-right">
            <div id="miniAmmoText" class="mini-ammo">🚀 ${p.ammo}/10</div>
            <button onclick="closePanel()" class="mini-close-btn">×</button>
        </div>
    </div>
    `;

    updateMiniPanelUI();
}

function toggleAuto(){
    if(!activePVO) return;
    activePVO.auto = !activePVO.auto;
    if(activePVO.auto) manualMode = false;
    updateMiniPanelUI();
}

function toggleManual(){
    if(!activePVO) return;
    manualMode = !manualMode;
    if(manualMode) activePVO.auto = false;
    updateMiniPanelUI();
}

document.addEventListener("keydown", e => {
    if(e.key === "c" || e.key === "с") toggleAuto();
    if(e.key === "e" || e.key === "у") toggleManual();
});

function findDroneNear(latlng){
    let best = null;
    let bestDist = 999999;

    for(let d of drones){
        if(!d.alive) continue;
        let dist = map.distance(latlng, [d.lat, d.lng]);
        if(dist < 35000 && dist < bestDist){
            best = d;
            bestDist = dist;
        }
    }
    return best;
}

/* ================= AUTO FIRE SYSTEM ================= */
setInterval(() => {
    for(let p of pvos){
        if(!p.auto) continue;
        for(let d of drones){
            if(!d.alive || d.locked) continue;
            let dist = map.distance(p.latlng, [d.lat, d.lng]);
            if(dist <= 95000){
                fire(p, d);
                break;
            }
        }
    }
}, 1000);

/* ================= INTERCEPT ENGINE ================= */
function fire(pvo, drone){
    if(!pvo || !drone || !drone.alive || drone.locked) return;
    
    if(pvo.ammo <= 0){
        if(!pvo.reloading){
            pvo.reloading = true;
            setTimeout(() => {
                pvo.ammo = 10;
                if(activePVO === pvo) updateMiniPanelUI();
                pvo.reloading = false;
            }, 8000);
        }
        return;
    }

    drone.locked = true;
    pvo.ammo--;
    if(activePVO === pvo) updateMiniPanelUI();

    launchSound();

    let rocket = L.marker(pvo.latlng, {
        icon: L.divIcon({
            className: "",
            iconSize: [32,32],
            iconAnchor: [16,16],
            html: `
            <div style="position:relative; width:32px; height:32px;">
                <div style="position:absolute; width:12px; height:12px; border-radius:50%; background:rgba(255,140,0,0.4); left:10px; top:10px; filter:blur(4px);"></div>
                <img src="icons/rocket.png" style="width:32px; position:absolute; left:0; top:0; filter:drop-shadow(0 0 8px #ffd54a);">
            </div>`
        })
    }).addTo(map);

    let line = L.polyline([pvo.latlng, drone.marker.getLatLng()], {
        color: "rgba(255, 196, 0, 0.45)",
        weight: 1.5,
        dashArray: "6 8",
        interactive: false
    }).addTo(map);

    let i = 0;
    let steps = drone.isRocket ? 80 : 130;
    let startLat = pvo.latlng.lat;
    let startLng = pvo.latlng.lng;

    let int = setInterval(() => {
        if(!drone.alive){
            map.removeLayer(rocket);
            map.removeLayer(line);
            clearInterval(int);
            return;
        }

        i++;
        let t = i / steps;
        let curve = Math.sin(t * Math.PI) * 0.18;

        let lat = startLat + (drone.lat - startLat) * t + curve;
        let lng = startLng + (drone.lng - startLng) * t;

        rocket.setLatLng([lat, lng]);

        let futureT = t + 0.01;
        let futureCurve = Math.sin(futureT * Math.PI) * 0.18;
        let nextLat = startLat + (drone.lat - startLat) * futureT + futureCurve;
        let nextLng = startLng + (drone.lng - startLng) * futureT;
        let angle = Math.atan2(nextLng - lng, nextLat - lat) * 180 / Math.PI;

        let img = rocket.getElement()?.querySelector("img");
        if(img) img.style.transform = `rotate(${angle - 90}deg)`;

        line.setLatLngs([pvo.latlng, drone.marker.getLatLng()]);

        if(map.distance([lat, lng], [drone.lat, drone.lng]) < 8000){
            let p = map.latLngToContainerPoint([lat, lng]);
            createExplosion(p.x, p.y, "air");

            drone.alive = false;
            map.removeLayer(drone.marker);
            map.removeLayer(rocket);
            map.removeLayer(line);
            clearInterval(int);
            return;
        }

        if(i >= steps){
            map.removeLayer(rocket);
            map.removeLayer(line);
            clearInterval(int);
        }
    }, 25);
}

function bindDrone(d){
    d.marker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        if(!activePVO) return;
        let currentDist = map.distance(activePVO.latlng, [d.lat, d.lng]);
        if (currentDist <= 95000) {
            fire(activePVO, d);
        }
    });
}

/* ================= SIMULATION TICKER ================= */
setInterval(() => {
    for(let d of drones){
        if(!d.alive) continue;

        let dx = d.targetLat - d.lat;
        let dy = d.targetLng - d.lng;
        let dist = Math.sqrt(dx * dx + dy * dy);
        
        if(dist < 0.04){
            d.alive = false;
            map.removeLayer(d.marker);

            let pixelPos = map.latLngToContainerPoint([d.targetLat, d.targetLng]);
            createExplosion(pixelPos.x, pixelPos.y, "city");
            continue;
        }

        d.lat += (dx / dist) * d.speed;
        d.lng += (dy / dist) * d.speed;
        
        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        let img = d.marker.getElement()?.querySelector("img");
        if(img) img.style.transform = `rotate(${angle - 90}deg)`;

        if(!d.isRocket) {
            d.lat += Math.sin(Date.now() / 800) * 0.00006;
            d.lng += Math.cos(Date.now() / 900) * 0.00004;
        }

        d.marker.setLatLng([d.lat, d.lng]);
    }
}, 40);

/* ================= CLEANUP MEMORY ================= */
setInterval(() => {
    drones = drones.filter(d => {
        if(!d.alive) return false;
        if(d.lat > 54 || d.lng > 43) {
            map.removeLayer(d.marker);
            return false;
        }
        return true;
    });
}, 3000);

function closePanel() {
    document.getElementById("side").style.display = "none";
    if(activePVO && activePVO.marker.getElement()) {
        activePVO.marker.getElement().classList.remove("pvo-active");
    }
}
