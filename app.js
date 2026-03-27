(() => {
  const $ = (sel) => document.querySelector(sel);

  const els = {
    board: $("#board"),
    palette: $("#palette"),
    btnUndo: $("#btnUndo"),
    btnClear: $("#btnClear"),
    fileImportImage: $("#fileImportImage"),
    btnExportPng: $("#btnExportPng"),
    selSize: $("#selSize"),
    rngZoom: $("#rngZoom"),
    txtZoom: $("#txtZoom"),
    chkGrid: $("#chkGrid"),
    btnEraser: $("#btnEraser"),
    inpColor: $("#inpColor"),
    statColors: $("#statColors"),
    statFilled: $("#statFilled"),
    dlgExport: $("#dlgExport"),
    dlgContent: $("#dlgContent"),
  };

  const ctx = els.board.getContext("2d", { alpha: true });

  const DEFAULT_PALETTE = [
    "#ffffff",
    "#d1d5db",
    "#9ca3af",
    "#111827",
    "#ff3b30",
    "#ff9500",
    "#ffd60a",
    "#34c759",
    "#0a84ff",
    "#5e5ce6",
    "#bf5af2",
    "#ff2d55",
    "#a2845e",
    "#00c7be",
    "#64d2ff",
    "#ff9f0a",
  ];

  const PALETTE_RGB = DEFAULT_PALETTE.map((hex) => {
    const h = String(hex).replace("#", "").trim();
    const isShort = h.length === 3;
    const full = isShort ? h.split("").map((ch) => ch + ch).join("") : h;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return { hex, r, g, b };
  });

  const state = {
    n: Number(els.selSize.value),
    cellPx: Number(els.rngZoom.value),
    showGrid: els.chkGrid.checked,
    currentColor: DEFAULT_PALETTE[4],
    eraser: false,
    cells: [],
    undo: [],
    redo: [],
    drawing: false,
    drawMode: "paint", // paint | erase
    lastIndex: -1,
  };

  const STORAGE_KEY = "pindou_v1";
  let saveTimer = 0;
  let lastVibrateAt = 0;

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        const payload = {
          version: 1,
          n: state.n,
          cells: state.cells,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // ignore (e.g. storage disabled)
      }
    }, 120);
  }

  function restoreFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const obj = JSON.parse(raw);
      if (!obj || obj.version !== 1) return false;
      const n = obj.n | 0;
      if (![16, 24, 32, 48, 64].includes(n)) return false;
      if (!Array.isArray(obj.cells)) return false;
      if (obj.cells.length !== n * n) return false;

      state.n = n;
      els.selSize.value = String(n);
      state.cells = obj.cells.map((c) => (typeof c === "string" ? c : null));
      state.undo = [];
      state.redo = [];
      state.drawing = false;
      state.lastIndex = -1;
      state.drawMode = "paint";
      state.eraser = false;
      return true;
    } catch {
      return false;
    }
  }

  function vibrateTick() {
    const now = Date.now();
    if (now - lastVibrateAt < 80) return;
    lastVibrateAt = now;

    try {
      if (navigator && typeof navigator.vibrate === "function") {
        navigator.vibrate(10);
      }
    } catch {
      // ignore
    }
  }

  function idx(x, y) {
    return y * state.n + x;
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function hexToRgba(hex, alpha) {
    // Supports "#RRGGBB" and "#RGB".
    const h = String(hex).replace("#", "").trim();
    const isShort = h.length === 3;
    const full = isShort ? h.split("").map((ch) => ch + ch).join("") : h;
    if (full.length !== 6) return `rgba(0,0,0,${alpha})`;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function makeEmptyCells() {
    return Array(state.n * state.n).fill(null);
  }

  function pushUndo() {
    state.undo.push(state.cells.slice());
    if (state.undo.length > 80) state.undo.shift();
    state.redo = [];
    syncButtons();
  }

  function syncButtons() {
    els.btnUndo.disabled = state.undo.length === 0;
    els.btnEraser.setAttribute("aria-pressed", String(state.eraser));
    els.btnEraser.classList.toggle("btnDanger", state.eraser);
  }

  function resizeCanvas() {
    const px = state.cellPx;
    const size = state.n * px;
    els.board.width = size;
    els.board.height = size;
    els.board.style.width = `${size}px`;
    els.board.style.height = `${size}px`;
    els.txtZoom.textContent = `${px}px`;
  }

  function beadFillStyle(color, x, y, px) {
    // Slightly translucent "plastic" bead with a micro radial gradient highlight.
    const cx = x + px * 0.38;
    const cy = y + px * 0.32;
    const r0 = px * 0.08;
    const r1 = px * 0.72;
    const g = ctx.createRadialGradient(cx, cy, r0, x + px * 0.55, y + px * 0.64, r1);

    // Use alpha to mimic plastic translucency.
    g.addColorStop(0, "rgba(255,255,255,0.60)");
    g.addColorStop(0.18, hexToRgba(color, 0.78));
    g.addColorStop(0.55, hexToRgba(color, 0.62));
    g.addColorStop(1, "rgba(0,0,0,0.24)");

    return g;
  }

  function drawCell(i) {
    const px = state.cellPx;
    const x = (i % state.n) * px;
    const y = Math.floor(i / state.n) * px;
    ctx.clearRect(x, y, px, px);

    const c = state.cells[i];
    if (c) {
      const pad = Math.max(1, Math.floor(px * 0.10));
      const r = Math.max(2, Math.floor((px - pad * 2) / 2));
      const cx = x + px / 2;
      const cy = y + px / 2;

      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = beadFillStyle(c, x, y, px);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Specular highlight overlay (very subtle).
      ctx.globalAlpha = 0.35;
      ctx.globalCompositeOperation = "lighter";
      const plastHg = ctx.createRadialGradient(cx - r * 0.28, cy - r * 0.34, r * 0.05, cx, cy, r * 0.9);
      plastHg.addColorStop(0, "rgba(255,255,255,0.65)");
      plastHg.addColorStop(0.35, "rgba(255,255,255,0.18)");
      plastHg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = plastHg;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Outer ring: plastic rim (dark + a bit of light).
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = Math.max(1, Math.floor(px * 0.06));
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = Math.max(1, Math.floor(px * 0.035));
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // center hole
      const hr = Math.max(1.5, r * 0.28);
      const hg = ctx.createRadialGradient(cx - hr * 0.25, cy - hr * 0.25, 0.1, cx, cy, hr);
      hg.addColorStop(0, "rgba(0,0,0,0.35)");
      hg.addColorStop(1, "rgba(255,255,255,0.15)");
      ctx.save();
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(cx, cy, hr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (state.showGrid) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, px - 1, px - 1);
      ctx.restore();
    }
  }

  function drawAll() {
    ctx.clearRect(0, 0, els.board.width, els.board.height);
    for (let i = 0; i < state.cells.length; i++) drawCell(i);
    updateStats();
  }

  function updateStats() {
    let filled = 0;
    const colors = new Set();
    for (const c of state.cells) {
      if (c) {
        filled++;
        colors.add(c);
      }
    }
    els.statFilled.textContent = String(filled);
    els.statColors.textContent = String(colors.size);
  }

  function setPaletteSelected(color) {
    for (const btn of els.palette.querySelectorAll(".swatch")) {
      btn.setAttribute("aria-selected", btn.dataset.color === color ? "true" : "false");
    }
  }

  function setColor(color) {
    state.currentColor = color;
    els.inpColor.value = color;
    state.eraser = false;
    setPaletteSelected(color);
    syncButtons();
  }

  function buildPalette() {
    els.palette.innerHTML = "";
    for (const color of DEFAULT_PALETTE) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.style.background = color;
      b.dataset.color = color;
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", "false");
      b.title = color;
      b.addEventListener("click", () => setColor(color));
      els.palette.appendChild(b);
    }
    setPaletteSelected(state.currentColor);
  }

  function pointerToCellIndex(clientX, clientY) {
    const rect = els.board.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const px = state.cellPx;
    const cx = clamp(Math.floor(x / px), 0, state.n - 1);
    const cy = clamp(Math.floor(y / px), 0, state.n - 1);
    return idx(cx, cy);
  }

  function applyAtIndex(i, mode) {
    if (i === state.lastIndex) return;
    state.lastIndex = i;

    const next = mode === "erase" ? null : state.currentColor;
    if (state.cells[i] === next) return;

    state.cells[i] = next;
    drawCell(i);
    updateStats();
    scheduleSave();
    vibrateTick();
  }

  function startDraw(i, mode) {
    pushUndo();
    state.drawing = true;
    state.drawMode = mode;
    state.lastIndex = -1;
    applyAtIndex(i, mode);
  }

  function stopDraw() {
    state.drawing = false;
    state.lastIndex = -1;
  }

  function exportJSON() {
    const payload = {
      version: 1,
      n: state.n,
      cellPx: state.cellPx,
      cells: state.cells,
      createdAt: new Date().toISOString(),
    };
    return JSON.stringify(payload, null, 2);
  }

  function importJSON(text) {
    const obj = JSON.parse(text);
    if (!obj || obj.version !== 1) throw new Error("不支持的 JSON 格式");
    if (typeof obj.n !== "number" || !Array.isArray(obj.cells)) throw new Error("JSON 缺少必要字段");
    const n = obj.n | 0;
    if (![16, 24, 32, 48, 64].includes(n)) throw new Error("画板尺寸不合法");
    if (obj.cells.length !== n * n) throw new Error("cells 长度与尺寸不匹配");

    state.n = n;
    els.selSize.value = String(n);
    state.cells = obj.cells.map((c) => (typeof c === "string" ? c : null));
    state.undo = [];
    state.redo = [];
    resizeCanvas();
    drawAll();
    syncButtons();
    scheduleSave();
  }

  function openDialog(node) {
    els.dlgContent.innerHTML = "";
    els.dlgContent.appendChild(node);
    els.dlgExport.showModal();
  }

  function downloadBlob(filename, blob) {
    const a = document.createElement("a");
    a.download = filename;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function renderPngToBlob() {
    return new Promise((resolve) => {
      els.board.toBlob((b) => resolve(b), "image/png");
    });
  }

  function findNearestPaletteHex(r, g, b) {
    let best = PALETTE_RGB[0];
    let bestD = Infinity;
    for (const p of PALETTE_RGB) {
      const dr = r - p.r;
      const dg = g - p.g;
      const db = b - p.b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best.hex;
  }

  async function imageFileToMosaic(file, blockPx) {
    if (!file || !file.type || !file.type.startsWith("image/")) {
      throw new Error("请选择常见图片格式（jpg/png/webp 等）");
    }
    const bp = Number(blockPx);
    if (![5, 10, 15, 20, 25].includes(bp)) throw new Error("小方块密度不合法");

    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();

      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (!iw || !ih) throw new Error("图片尺寸无效");

      // Number of blocks is derived from original size & chosen block pixel size.
      // Keeps aspect ratio identical to the uploaded image.
      const blocksW = Math.max(1, Math.round(iw / bp));
      const blocksH = Math.max(1, Math.round(ih / bp));

      // Sample to a small bitmap where each pixel == one block color.
      const sc = document.createElement("canvas");
      sc.width = blocksW;
      sc.height = blocksH;
      const sctx = sc.getContext("2d", { willReadFrequently: true });
      if (!sctx) throw new Error("无法处理图片（Canvas 不可用）");
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = "high";
      sctx.clearRect(0, 0, blocksW, blocksH);
      sctx.drawImage(img, 0, 0, iw, ih, 0, 0, blocksW, blocksH);

      const { data } = sctx.getImageData(0, 0, blocksW, blocksH);
      const cells = Array(blocksW * blocksH).fill(null);
      for (let y = 0; y < blocksH; y++) {
        for (let x = 0; x < blocksW; x++) {
          const off = (y * blocksW + x) * 4;
          const a = data[off + 3];
          if (a < 18) continue;
          const r = data[off];
          const g = data[off + 1];
          const b = data[off + 2];
          cells[y * blocksW + x] = findNearestPaletteHex(r, g, b);
        }
      }

      // Render preview/export canvas as seamless squares (no borders, no circles).
      const oc = document.createElement("canvas");
      oc.width = blocksW * bp;
      oc.height = blocksH * bp;
      const octx = oc.getContext("2d");
      if (!octx) throw new Error("无法渲染预览（Canvas 不可用）");
      octx.imageSmoothingEnabled = false;
      for (let y = 0; y < blocksH; y++) {
        for (let x = 0; x < blocksW; x++) {
          const c = cells[y * blocksW + x];
          if (!c) continue;
          octx.fillStyle = c;
          octx.fillRect(x * bp, y * bp, bp, bp);
        }
      }

      return { canvas: oc, cells, blocksW, blocksH, blockPx: bp };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function mosaicToBoardCells(mosaic) {
    const { cells, blocksW, blocksH } = mosaic;
    const n = state.n;
    const out = Array(n * n).fill(null);

    const scale = Math.min(n / blocksW, n / blocksH);
    const dw = Math.max(1, Math.round(blocksW * scale));
    const dh = Math.max(1, Math.round(blocksH * scale));
    const dx = Math.floor((n - dw) / 2);
    const dy = Math.floor((n - dh) / 2);

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const lx = x - dx;
        const ly = y - dy;
        if (lx < 0 || ly < 0 || lx >= dw || ly >= dh) continue;
        const sx = clamp(Math.floor(lx / scale), 0, blocksW - 1);
        const sy = clamp(Math.floor(ly / scale), 0, blocksH - 1);
        out[y * n + x] = cells[sy * blocksW + sx];
      }
    }
    return out;
  }

  // events
  els.btnUndo.addEventListener("click", () => {
    const prev = state.undo.pop();
    if (!prev) return;
    state.redo.push(state.cells.slice());
    state.cells = prev;
    drawAll();
    syncButtons();
    scheduleSave();
  });

  els.btnClear.addEventListener("click", () => {
    pushUndo();
    state.cells = makeEmptyCells();
    drawAll();
    scheduleSave();
  });

  els.btnExportPng.addEventListener("click", async () => {
    const blob = await renderPngToBlob();
    if (!blob) return;
    downloadBlob(`pindou_${state.n}x${state.n}.png`, blob);

    const img = document.createElement("img");
    img.alt = "导出预览";
    img.style.maxWidth = "100%";
    img.style.borderRadius = "12px";
    img.style.display = "block";
    img.src = URL.createObjectURL(blob);
    openDialog(img);
    img.addEventListener("load", () => {
      setTimeout(() => URL.revokeObjectURL(img.src), 5000);
    });
  });

  els.fileImportImage.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;

    try {
      const wrap = document.createElement("div");
      wrap.style.display = "grid";
      wrap.style.gap = "10px";

      const formRow = document.createElement("div");
      formRow.style.display = "flex";
      formRow.style.gap = "10px";
      formRow.style.flexWrap = "wrap";
      formRow.style.alignItems = "center";
      formRow.style.justifyContent = "space-between";

      const label = document.createElement("div");
      label.textContent = "小方块密度";
      label.style.color = "rgba(255,255,255,0.75)";
      label.style.fontSize = "12px";

      const sel = document.createElement("select");
      sel.className = "select";
      sel.style.maxWidth = "220px";
      sel.innerHTML = `
        <option value="5">5 × 5 像素（更密）</option>
        <option value="10" selected>10 × 10 像素</option>
        <option value="15">15 × 15 像素</option>
        <option value="20">20 × 20 像素</option>
        <option value="25">25 × 25 像素（更粗）</option>
      `;

      formRow.appendChild(label);
      formRow.appendChild(sel);
      wrap.appendChild(formRow);

      const previewHost = document.createElement("div");
      previewHost.style.display = "grid";
      previewHost.style.placeItems = "start center";
      previewHost.style.gap = "10px";
      wrap.appendChild(previewHost);

      const btnRow = document.createElement("div");
      btnRow.style.display = "flex";
      btnRow.style.gap = "10px";
      btnRow.style.flexWrap = "wrap";
      btnRow.style.justifyContent = "flex-end";

      const btnGen = document.createElement("button");
      btnGen.type = "button";
      btnGen.className = "btn";
      btnGen.textContent = "生成图纸";

      const btnApply = document.createElement("button");
      btnApply.type = "button";
      btnApply.className = "btn";
      btnApply.textContent = "应用到画板（保持比例）";
      btnApply.disabled = true;

      const btnExport = document.createElement("button");
      btnExport.type = "button";
      btnExport.className = "btn";
      btnExport.textContent = "导出图纸 PNG";
      btnExport.disabled = true;

      btnRow.appendChild(btnGen);
      btnRow.appendChild(btnApply);
      btnRow.appendChild(btnExport);
      wrap.appendChild(btnRow);

      let mosaic = null;

      const renderPreview = (canvas) => {
        previewHost.innerHTML = "";
        canvas.style.width = "100%";
        canvas.style.maxWidth = "520px";
        canvas.style.borderRadius = "12px";
        canvas.style.border = "1px solid rgba(255,255,255,0.12)";
        canvas.style.background = "rgba(0,0,0,0.15)";
        canvas.style.imageRendering = "pixelated";
        previewHost.appendChild(canvas);
      };

      const applyToBoard = async () => {
        if (!mosaic) return;
        pushUndo();
        state.cells = mosaicToBoardCells(mosaic);
        drawAll();
        scheduleSave();
        vibrateTick();
      };

      btnGen.addEventListener("click", async () => {
        btnGen.disabled = true;
        btnGen.textContent = "生成中…";
        try {
          mosaic = await imageFileToMosaic(f, Number(sel.value));
          renderPreview(mosaic.canvas);
          btnApply.disabled = false;
          btnExport.disabled = false;
        } finally {
          btnGen.disabled = false;
          btnGen.textContent = "重新生成";
        }
      });

      btnApply.addEventListener("click", applyToBoard);
      btnExport.addEventListener("click", async () => {
        if (!mosaic) return;
        const blob = await new Promise((resolve) => mosaic.canvas.toBlob((b) => resolve(b), "image/png"));
        if (!blob) return;
        downloadBlob(`pindou_sheet_${mosaic.blocksW}x${mosaic.blocksH}_${mosaic.blockPx}px.png`, blob);
      });

      openDialog(wrap);
    } catch (err) {
      alert(err instanceof Error ? err.message : "生成图纸失败");
    }
  });

  els.selSize.addEventListener("change", () => {
    const n = Number(els.selSize.value);
    state.n = n;
    state.cells = makeEmptyCells();
    state.undo = [];
    state.redo = [];
    resizeCanvas();
    drawAll();
    syncButtons();
    scheduleSave();
  });

  els.rngZoom.addEventListener("input", () => {
    state.cellPx = Number(els.rngZoom.value);
    resizeCanvas();
    drawAll();
  });

  els.chkGrid.addEventListener("change", () => {
    state.showGrid = els.chkGrid.checked;
    drawAll();
  });

  els.btnEraser.addEventListener("click", () => {
    state.eraser = !state.eraser;
    syncButtons();
  });

  els.inpColor.addEventListener("input", () => {
    setColor(els.inpColor.value);
  });

  els.board.addEventListener("contextmenu", (e) => e.preventDefault());

  function onPointerDown(e) {
    // Prevent page scroll / bounce while drawing on mobile browsers.
    e.preventDefault?.();
    els.board.setPointerCapture?.(e.pointerId);
    const i = pointerToCellIndex(e.clientX, e.clientY);

    const erase = e.button === 2 || e.ctrlKey || state.eraser;
    startDraw(i, erase ? "erase" : "paint");
  }

  function onPointerMove(e) {
    if (!state.drawing) return;
    e.preventDefault?.();
    const i = pointerToCellIndex(e.clientX, e.clientY);
    applyAtIndex(i, state.drawMode);
  }

  function onPointerUp() {
    stopDraw();
  }

  els.board.addEventListener("pointerdown", onPointerDown, { passive: false });
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  window.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod) return;

    const k = e.key.toLowerCase();
    if (k === "z") {
      e.preventDefault();
      els.btnUndo.click();
    }
  });

  // init
  function init() {
    // PWA offline support (Android/iOS; iOS supports SW in modern versions).
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("./sw.js")
          .then((reg) => {
            const forceActivate = (r) => {
              if (r.waiting) {
                r.waiting.postMessage({ type: "SKIP_WAITING" });
              }
            };

            // Always check for a newer version on each visit.
            reg.update().catch(() => {});
            forceActivate(reg);

            reg.addEventListener("updatefound", () => {
              const installing = reg.installing;
              if (!installing) return;
              installing.addEventListener("statechange", () => {
                if (installing.state === "installed") {
                  // If we already have a controller, then an update is ready: activate immediately.
                  if (navigator.serviceWorker.controller) {
                    forceActivate(reg);
                  }
                }
              });
            });

            // If an updated SW takes control, reload so user runs the new version.
            let reloaded = false;
            navigator.serviceWorker.addEventListener("controllerchange", () => {
              if (reloaded) return;
              reloaded = true;
              window.location.reload();
            });
          })
          .catch(() => {});
      });
    }

    buildPalette();

    if (!restoreFromStorage()) {
      state.cells = makeEmptyCells();
    }

    resizeCanvas();
    drawAll();
    setColor(state.currentColor);
    syncButtons();
    scheduleSave();
  }

  init();
})();
