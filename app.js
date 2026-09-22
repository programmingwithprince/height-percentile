// dev note: fetch csv directly so we don't have to keep rebuilding json
// tools.31415929.xyz - systems node

let DATA = {}
const ID_TO_KEY = {}
let activeRegionKey = "germany"
let activeGender = "male"
let activeUnit = "cm"  // cm or ft
let worldTopology = null

// iso map for world atlas svg paths (3-digit un codes)
const ISO_MAP = {
  "afghanistan":"004","albania":"008","algeria":"012","andorra":"020","angola":"024",
  "antiguaandbarbuda":"028","argentina":"032","armenia":"051","australia":"036",
  "austria":"040","azerbaijan":"031","bahamas":"044","bahrain":"048","bangladesh":"050",
  "barbados":"052","belarus":"112","belgium":"056","belize":"084","benin":"204",
  "bhutan":"064","bolivia":"068","bosniaandherzegovina":"070","botswana":"072",
  "brazil":"076","brunei":"096","bulgaria":"100","burkinafaso":"854","burundi":"108",
  "cambodia":"116","cameroon":"120","canada":"124","capeverde":"132","centralafricanrepublic":"140",
  "chad":"148","chile":"152","china":"156","colombia":"170","comoros":"174",
  "congo":"178","democraticrepublicofthecongo":"180","costarica":"188","cotedivoire":"384",
  "croatia":"191","cuba":"192","cyprus":"196","czechrepublic":"203","denmark":"208",
  "djibouti":"262","dominica":"212","dominicanrepublic":"214","ecuador":"218","egypt":"818",
  "elsalvador":"222","equatorialguinea":"226","eritrea":"232","estonia":"233","eswatini":"748",
  "ethiopia":"231","fiji":"242","finland":"246","france":"250","gabon":"266","gambia":"270",
  "georgia":"268","germany":"276","ghana":"288","greece":"300","grenada":"308",
  "guatemala":"320","guinea":"324","guineabissau":"624","guyana":"328","haiti":"332",
  "honduras":"340","hongkong":"344","hungary":"348","iceland":"352","india":"356",
  "indonesia":"360","iran":"364","iraq":"368","ireland":"372","israel":"376","italy":"380",
  "jamaica":"388","japan":"392","jordan":"400","kazakhstan":"398","kenya":"404",
  "kiribati":"296","northkorea":"408","southkorea":"410","kuwait":"414","kyrgyzstan":"417",
  "laos":"418","latvia":"428","lebanon":"422","lesotho":"426","liberia":"430","libya":"434",
  "liechtenstein":"438","lithuania":"440","luxembourg":"442","madagascar":"450","malawi":"454",
  "malaysia":"458","maldives":"462","mali":"466","malta":"470","marshallislands":"584",
  "mauritania":"478","mauritius":"480","mexico":"484","micronesia":"583","moldova":"498",
  "monaco":"492","mongolia":"496","montenegro":"499","morocco":"504","mozambique":"508",
  "myanmar":"104","namibia":"516","nauru":"520","nepal":"524","netherlands":"528",
  "newzealand":"554","nicaragua":"558","niger":"562","nigeria":"566","northmacedonia":"807",
  "norway":"578","oman":"512","pakistan":"586","palau":"585","palestine":"275",
  "panama":"591","papuanewguinea":"598","paraguay":"600","peru":"604","philippines":"608",
  "poland":"616","portugal":"620","qatar":"634","romania":"642","russia":"643",
  "rwanda":"646","saintkittsandnevis":"659","saintlucia":"662","saintvincentandthegrenadines":"670",
  "samoa":"882","sanmarino":"674","saotomeandprincipe":"678","saudiarabia":"682",
  "senegal":"686","serbia":"688","seychelles":"690","sierraleone":"694","singapore":"702",
  "slovakia":"703","slovenia":"705","solomonislands":"090","somalia":"706","southafrica":"710",
  "southsudan":"728","spain":"724","srilanka":"144","sudan":"729","suriname":"740",
  "sweden":"752","switzerland":"756","syria":"760","taiwan":"158","tajikistan":"762",
  "tanzania":"834","thailand":"764","timorleste":"626","togo":"768","tonga":"776",
  "trinidadandtobago":"780","tunisia":"788","turkey":"792","turkmenistan":"795",
  "tuvalu":"798","uganda":"800","ukraine":"804","unitedarabemirates":"784",
  "unitedkingdom":"826","unitedstates":"840","uruguay":"858","uzbekistan":"860",
  "vanuatu":"548","venezuela":"862","vietnam":"704","yemen":"887","zambia":"894","zimbabwe":"716",
  "bermuda":"060","puertorico":"630","cookislands":"184","frenchpolynesia":"258",
  "niue":"570","americansamoa":"016","greenland":"304","republicofthecongo":"178",
  "drcongo":"180","ivorycoast":"384"
}

// conv helpers
function cmToFtIn(cm) {
  const totIn = cm / 2.54;
  const ft = Math.floor(totIn / 12);
  const inches = (totIn % 12).toFixed(1);
  return { ft, inches, str: `${ft}′ ${inches}″` };
}

function ftInToCm(ft, inches) {
  return (parseFloat(ft || 0) * 12 + parseFloat(inches || 0)) * 2.54;
}

// abramowitz & stegun cdf approx (accurate to ~10^-7)
function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - prob : prob;
}

// live utc clock in footer
function updateClock() {
  const el = document.getElementById("footer-utc");
  if (!el) return;
  const parts = new Date().toUTCString().split(' ');
  el.textContent = `UTC: ${parts[4] || '00:00:00'}`;
}
setInterval(updateClock, 1000);
updateClock();

function showToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("active");
  setTimeout(() => toast.classList.remove("active"), 2600);
}

// parse raw csv string from disk
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const parsed = [];
  
  // skip line 0 (headers: Region, Average Male Height 2019, Average Female Height 2019)
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    if (row.length >= 3) {
      const region = row[0].trim();
      const mMean = parseFloat(row[1]);
      const fMean = parseFloat(row[2]);
      if (region && !isNaN(mMean) && !isNaN(fMean)) {
        parsed.push({ region, mMean, fMean });
      }
    }
  }
  return parsed;
}

function buildDatasetFromCSV(rows) {
  // sort & calculate ranks for male and female
  const maleSorted = [...rows].sort((a, b) => b.mMean - a.mMean);
  const femaleSorted = [...rows].sort((a, b) => b.fMean - a.fMean);

  const maleRanks = {};
  const femaleRanks = {};
  maleSorted.forEach((r, idx) => { maleRanks[r.region] = idx + 1; });
  femaleSorted.forEach((r, idx) => { femaleRanks[r.region] = idx + 1; });

  const dataset = {};
  
  // global worldwide average entry
  dataset["worldwide"] = {
    id: "000",
    name: "Worldwide",
    mMean: 173.1,
    fMean: 160.9,
    mSD: 7.3,
    fSD: 6.6,
    rankM: 100,
    rankF: 100
  };

  rows.forEach(r => {
    const cleanKey = r.region.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isoId = ISO_MAP[cleanKey] || "000";
    
    // cv ~ 4.1% male, 4.0% female
    const mSD = +(r.mMean * 0.041).toFixed(1);
    const fSD = +(r.fMean * 0.040).toFixed(1);

    dataset[cleanKey] = {
      id: isoId,
      name: r.region,
      mMean: r.mMean,
      fMean: r.fMean,
      mSD: mSD,
      fSD: fSD,
      rankM: maleRanks[r.region] || 99,
      rankF: femaleRanks[r.region] || 99
    };
  });

  return dataset;
}

// read user height converted to cm
function getUserHeightCm() {
  if (activeUnit === "ft") {
    const ftEl = document.getElementById("user-height-ft");
    const inEl = document.getElementById("user-height-in");
    const ft = parseFloat(ftEl ? ftEl.value : 5);
    const inches = parseFloat(inEl ? inEl.value : 10.9);
    return ftInToCm(ft, inches);
  }
  const cmEl = document.getElementById("user-height-input");
  return parseFloat(cmEl ? cmEl.value : 180.2);
}

// updates numbers, percentiles (4 decimals), and canvas bell curve
function updateMetrics() {
  if (!DATA[activeRegionKey]) return;
  const reg = DATA[activeRegionKey];
  const mean = activeGender === "male" ? reg.mMean : reg.fMean;
  const sd = activeGender === "male" ? reg.mSD : reg.fSD;
  const rank = activeGender === "male" ? reg.rankM : reg.rankF;
  const userHeightCm = getUserHeightCm();

  // calculate z-score & percentile
  const z = (userHeightCm - mean) / sd;
  const rawPct = normalCDF(z) * 100;
  
  // clamp and format to 4 decimal places
  const pctStr = Math.min(99.9999, Math.max(0.0001, rawPct)).toFixed(4);

  // dom updates
  const avgEl = document.getElementById("metric-avg");
  if (avgEl) {
    avgEl.innerHTML = activeUnit === "ft" ? cmToFtIn(mean).str : `${mean.toFixed(1)} <span class="unit">CM</span>`;
  }

  const meanIndEl = document.getElementById("mean-indicator");
  if (meanIndEl) {
    meanIndEl.innerText = `Mean: ${activeUnit === "ft" ? cmToFtIn(mean).str : mean.toFixed(1) + " cm"}`;
  }

  const rankEl = document.getElementById("metric-rank");
  if (rankEl) rankEl.innerText = rank ? `#${rank}` : '#--';

  const pctEl = document.getElementById("metric-percentile");
  if (pctEl) pctEl.innerText = pctStr;

  drawBellCurve(mean, sd, userHeightCm);
}

// render canvas distribution curve
function drawBellCurve(mean, sd, userHeight) {
  const canvas = document.getElementById("bellCurveCanvas");
  const wrapper = document.getElementById("canvas-wrapper");
  if (!wrapper || !canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const w = wrapper.clientWidth;
  const h = wrapper.clientHeight;
  
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const minX = mean - 3.5 * sd;
  const maxX = mean + 3.5 * sd;

  const toX = (val) => ((val - minX) / (maxX - minX)) * (w - 60) + 30;
  const gaussian = (val) => (1 / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((val - mean) / sd, 2));

  const peakDensity = gaussian(mean);
  const toY = (val) => h - 45 - (gaussian(val) / peakDensity) * (h - 75);

  // shaded area
  ctx.beginPath();
  ctx.moveTo(toX(minX), h - 45);
  const step = 0.4;
  const cutoff = Math.min(Math.max(userHeight, minX), maxX);
  for (let x = minX; x <= cutoff; x += step) {
    ctx.lineTo(toX(x), toY(x));
  }
  ctx.lineTo(toX(cutoff), h - 45);
  ctx.closePath();

  const areaGrad = ctx.createLinearGradient(0, 20, 0, h - 45);
  areaGrad.addColorStop(0, "rgba(56, 189, 248, 0.4)");
  areaGrad.addColorStop(1, "rgba(14, 165, 233, 0.02)");
  ctx.fillStyle = areaGrad;
  ctx.fill();

  // grid lines
  [-2, -1, 1, 2].forEach(mul => {
    const xVal = mean + mul * sd;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(56, 189, 248, 0.18)";
    ctx.lineWidth = 1;
    ctx.moveTo(toX(xVal), h - 45);
    ctx.lineTo(toX(xVal), toY(xVal));
    ctx.stroke();
  });

  // bell ridge
  ctx.beginPath();
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2.2;
  for (let x = minX; x <= maxX; x += step) {
    const px = toX(x);
    const py = toY(x);
    if (x === minX) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // center axis
  ctx.beginPath();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.setLineDash([4, 4]);
  ctx.moveTo(toX(mean), h - 45);
  ctx.lineTo(toX(mean), toY(mean));
  ctx.stroke();
  ctx.setLineDash([]);

  // baseline
  ctx.beginPath();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.moveTo(15, h - 45);
  ctx.lineTo(w - 15, h - 45);
  ctx.stroke();

  // labels
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("±1σ", toX(mean - sd), h - 30);
  ctx.fillText("±1σ", toX(mean + sd), h - 30);
  ctx.fillText("±2σ", toX(mean - 2 * sd), h - 30);
  ctx.fillText("±2σ", toX(mean + 2 * sd), h - 30);
  ctx.fillStyle = "#64748b";
  ctx.fillText("95% POPULATION VARIANCE INTERVAL", toX(mean), h - 12);

  // user marker point
  if (userHeight >= minX && userHeight <= maxX) {
    const ux = toX(userHeight);
    ctx.beginPath();
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 2;
    ctx.moveTo(ux, h - 45);
    ctx.lineTo(ux, toY(userHeight));
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = "#22d3ee";
    ctx.arc(ux, toY(userHeight), 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// map projection
function renderWorldMap() {
  const container = document.getElementById("map-wrapper");
  if (!container || !worldTopology) return;

  const width = container.clientWidth;
  const height = container.clientHeight;
  const svg = d3.select("#world-map-svg");
  svg.selectAll("*").remove();

  // filter antarctica (id 010)
  const countries = topojson.feature(worldTopology, worldTopology.objects.countries)
    .features.filter(d => d.id !== "010");

  const featureCollection = { type: "FeatureCollection", features: countries };
  const projection = d3.geoNaturalEarth1()
    .fitExtent([[10, 10], [width - 10, height - 10]], featureCollection);

  const path = d3.geoPath().projection(projection);
  const tooltip = document.getElementById("map-tooltip");

  svg.selectAll("path")
    .data(countries)
    .enter()
    .append("path")
    .attr("class", d => `country-feature country-${d.id}`)
    .attr("d", path)
    .attr("fill", "#09101d")
    .attr("stroke", "#19263e")
    .attr("stroke-width", 0.6)
    .on("mousemove", function(event, d) {
      d3.select(this).classed("hovered", true);
      
      const countryKey = ID_TO_KEY[d.id] || "worldwide";
      const info = DATA[countryKey] || DATA["worldwide"];
      const mean = activeGender === "male" ? info.mMean : info.fMean;
      const sd = activeGender === "male" ? info.mSD : info.fSD;
      const userHCm = getUserHeightCm();
      const pct = Math.min(99.9999, Math.max(0.0001, normalCDF((userHCm - mean) / sd) * 100)).toFixed(4);

      const rect = container.getBoundingClientRect();
      tooltip.style.left = `${event.clientX - rect.left}px`;
      tooltip.style.top = `${event.clientY - rect.top}px`;
      tooltip.style.opacity = "1";

      document.getElementById("tt-region").innerText = info.name;
      document.getElementById("tt-avg").innerText = activeUnit === "ft" ? cmToFtIn(mean).str : `${mean.toFixed(1)} cm`;
      document.getElementById("tt-pct").innerText = `${pct}%`;
    })
    .on("mouseleave", function() {
      d3.select(this).classed("hovered", false);
      tooltip.style.opacity = "0";
    })
    .on("click", function(event, d) {
      const key = ID_TO_KEY[d.id];
      if (key) {
        activeRegionKey = key;
        document.getElementById("country-selector").value = key;
        updateMetrics();
        highlightActiveMapCountry();
      }
    });

  highlightActiveMapCountry();
}

function highlightActiveMapCountry() {
  d3.selectAll(".country-feature").classed("selected", false);
  const targetId = DATA[activeRegionKey] ? DATA[activeRegionKey].id : null;
  if (targetId && targetId !== "000") {
    d3.select(`.country-${targetId}`).classed("selected", true).raise();
  }
}

// inject unit switcher pills into dom without touching html
function setupDynamicUnitSwitcher() {
  const predictForm = document.querySelector(".predict-form");
  if (!predictForm) return;

  const controlBlock = predictForm.querySelector(".control-block");
  if (!controlBlock) return;

  const label = controlBlock.querySelector(".control-label");
  if (label) {
    label.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom: 4px;">
        <span id="unit-label-text">YOUR HEIGHT (${activeUnit.toUpperCase()})</span>
        <div style="display:inline-flex; background:#101623; border:1px solid rgba(56,189,248,0.25); border-radius:4px; padding:2px;">
          <button id="toggle-cm" type="button" style="background:${activeUnit === 'cm' ? '#0284c7' : 'transparent'}; color:#fff; border:none; padding:2px 8px; font-size:10px; font-family:'JetBrains Mono',monospace; border-radius:3px; cursor:pointer;">CM</button>
          <button id="toggle-ft" type="button" style="background:${activeUnit === 'ft' ? '#0284c7' : 'transparent'}; color:#fff; border:none; padding:2px 8px; font-size:10px; font-family:'JetBrains Mono',monospace; border-radius:3px; cursor:pointer;">FT</button>
        </div>
      </div>
    `;

    document.getElementById("toggle-cm").addEventListener("click", () => switchUnit("cm"));
    document.getElementById("toggle-ft").addEventListener("click", () => switchUnit("ft"));
  }
}

function switchUnit(newUnit) {
  if (activeUnit === newUnit) return;
  const currentCm = getUserHeightCm();
  activeUnit = newUnit;

  const btnCm = document.getElementById("toggle-cm");
  const btnFt = document.getElementById("toggle-ft");
  if (btnCm && btnFt) {
    btnCm.style.background = activeUnit === "cm" ? "#0284c7" : "transparent";
    btnFt.style.background = activeUnit === "ft" ? "#0284c7" : "transparent";
  }

  const labelText = document.getElementById("unit-label-text");
  if (labelText) labelText.textContent = `YOUR HEIGHT (${activeUnit.toUpperCase()})`;

  const inputContainer = document.querySelector(".input-unit-wrapper") || document.querySelector(".control-block > div:last-child");
  if (!inputContainer) return;

  if (activeUnit === "ft") {
    const { ft, inches } = cmToFtIn(currentCm);
    inputContainer.innerHTML = `
      <div style="display: flex; gap: 6px; width: 100%;">
        <div style="display: flex; align-items: center; gap: 4px; flex: 1;">
          <input type="number" id="user-height-ft" class="input-number" style="width: 100%;" value="${ft}" min="3" max="8" />
          <span class="unit">ft</span>
        </div>
        <div style="display: flex; align-items: center; gap: 4px; flex: 1;">
          <input type="number" id="user-height-in" class="input-number" style="width: 100%;" value="${inches}" min="0" max="11.9" step="0.1" />
          <span class="unit">in</span>
        </div>
      </div>
    `;
    document.getElementById("user-height-ft").addEventListener("input", updateMetrics);
    document.getElementById("user-height-in").addEventListener("input", updateMetrics);
  } else {
    inputContainer.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px; width: 100%;">
        <input type="number" id="user-height-input" class="input-number" style="width: 100%;" value="${currentCm.toFixed(1)}" step="0.5" min="100" max="250" />
        <span class="unit">cm</span>
      </div>
    `;
    document.getElementById("user-height-input").addEventListener("input", updateMetrics);
  }

  updateMetrics();
}

// snapshot export with attribution footer
async function exportTelemetrySnapshot() {
  const target = document.getElementById("capture-region");
  if (!target || typeof html2canvas === "undefined") return;

  showToast("Rendering telemetry visual...");

  const stamp = document.createElement("div");
  stamp.style.cssText = `
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #38bdf8;
    background: #07090e;
    padding: 10px 14px;
    border-top: 1px solid rgba(56, 189, 248, 0.4);
    text-align: center;
    letter-spacing: 0.08em;
  `;

stamp.innerHTML = `ORIGIN: tools.31415929.xyz/height-percentile/ • NODE // 31415929.XYZ • ENGINEERED BY PRINCE (@programmingwithprince)`;
  target.appendChild(stamp);

  try {
    const canvas = await html2canvas(target, {
      backgroundColor: "#07090e",
      scale: 2,
      useCORS: true,
      logging: false
    });

    stamp.remove();

    const link = document.createElement("a");
    const hVal = getUserHeightCm().toFixed(1);
    link.download = `height-telemetry-${hVal}cm-${activeRegionKey}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("Telemetry snapshot downloaded!");
  } catch (err) {
    console.error("Export failed:", err);
    stamp.remove();
    showToast("Snapshot error. Retrying fallback.");
  }
}


async function shareHeightCard() {
  const hCm = getUserHeightCm();
  const hDisplay = activeUnit === "ft" ? cmToFtIn(hCm).str : `${hCm.toFixed(1)} cm`;
  const pct = document.getElementById("metric-percentile") ? document.getElementById("metric-percentile").innerText : "50.0000";
  const country = DATA[activeRegionKey] ? DATA[activeRegionKey].name : "Worldwide";
  const shareUrl = "https://tools.31415929.xyz/height-percentile/";

  const shareText = `I am ${hDisplay} tall (${pct}% percentile in ${country}) on the Global Height Analytics Node.\nVerify your standing:`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: "Global Height Analytics Telemetry",
        text: shareText,
        url: shareUrl
      });
      return;
    } catch (e) {
      // user closed share tray
    }
  }

  try {
    await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
    showToast("Stats & link copied to clipboard!");
  } catch (e) {
    showToast("Unable to copy link.");
  }
}
// init workflow
async function initApp() {
  try {
    // 1. Fetch raw csv directly from root
    const res = await fetch("average-height-by-country.csv");
    if (!res.ok) throw new Error("CSV fetch failed");
    const csvText = await res.text();
    const rows = parseCSV(csvText);
    DATA = buildDatasetFromCSV(rows);

    Object.keys(DATA).forEach(k => {
      if (DATA[k].id !== "000") ID_TO_KEY[DATA[k].id] = k;
    });

    // populate selector
    const selector = document.getElementById("country-selector");
    if (selector) {
      Object.keys(DATA).forEach(key => {
        const opt = document.createElement("option");
        opt.value = key;
        opt.innerText = DATA[key].name;
        if (key === activeRegionKey) opt.selected = true;
        selector.appendChild(opt);
      });

      selector.addEventListener("change", (e) => {
        activeRegionKey = e.target.value;
        updateMetrics();
        highlightActiveMapCountry();
      });
    }

    // gender buttons
    const btnM = document.getElementById("btn-male");
    const btnF = document.getElementById("btn-female");
    if (btnM) {
      btnM.addEventListener("click", () => {
        activeGender = "male";
        btnM.classList.add("active");
        if (btnF) btnF.classList.remove("active");
        updateMetrics();
      });
    }
    if (btnF) {
      btnF.addEventListener("click", () => {
        activeGender = "female";
        btnF.classList.add("active");
        if (btnM) btnM.classList.remove("active");
        updateMetrics();
      });
    }

    const initialInput = document.getElementById("user-height-input");
    if (initialInput) initialInput.addEventListener("input", updateMetrics);

    const btnDl = document.getElementById("btn-download");
    if (btnDl) btnDl.addEventListener("click", exportTelemetrySnapshot);

    const btnSh = document.getElementById("btn-share");
    if (btnSh) btnSh.addEventListener("click", shareHeightCard);

    // setup dynamic cm/ft injection
    setupDynamicUnitSwitcher();

    // resize observer
    const resizeObserver = new ResizeObserver(() => {
      updateMetrics();
      if (worldTopology) renderWorldMap();
    });
    const cWrapper = document.getElementById("canvas-wrapper");
    const mWrapper = document.getElementById("map-wrapper");
    if (cWrapper) resizeObserver.observe(cWrapper);
    if (mWrapper) resizeObserver.observe(mWrapper);

    updateMetrics();

    // 2. Fetch topojson for d3 map
    const topo = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    worldTopology = topo;
    renderWorldMap();

  } catch (err) {
    console.error("Initialization failure:", err);
  }
}

window.addEventListener("DOMContentLoaded", initApp);
