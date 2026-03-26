/**
 * YouTube Video Web App - Client-side Logic
 * Handles API calls, dynamic rendering, workflow diagrams, and UI interactions.
 */

// ===== STATE =====
const state = {
    videoId: null,
    videoUrl: null,
    data: null,
    existingIdeas: [],
    isLoading: false,
};

// ===== DOM REFS =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== API CALLS =====

async function apiCall(endpoint, body) {
    const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) {
        throw new Error(data.error || "Erro desconhecido");
    }
    return data;
}

// ===== ANALYZE VIDEO =====

async function analyzeVideo() {
    const input = $("#url-input");
    const url = input.value.trim();
    if (!url) {
        showToast("Cole o link do vídeo do YouTube");
        return;
    }

    showLoading("Extraindo transcrição do vídeo...");

    try {
        let transcriptData = null;
        
        // Tenta usar a Extensão do Chrome (se instalada)
        if (window.ytAnalyzerExtensionInstalled) {
            updateLoadingStep("Usando Extensão Pro para capturar legendas...");
            const videoIdMatch = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
            const videoId = videoIdMatch ? videoIdMatch[1] : url;
            
            transcriptData = await new Promise((resolve) => {
                const reqId = Date.now().toString();
                // Timeout limite p/ extensão (8s)
                const timeout = setTimeout(() => resolve(null), 8000);
                
                const listener = (event) => {
                    if (event.source !== window || !event.data || event.data.type !== "YT_ANALYZER_RESPONSE") return;
                    if (event.data.id === reqId) {
                        clearTimeout(timeout);
                        window.removeEventListener("message", listener);
                        if (event.data.success) {
                            resolve(event.data.transcript);
                        } else {
                            showToast(`⚠️ Extensão falhou: ${event.data.error || "Erro desconhecido"}`);
                            resolve(null);
                        }
                    }
                };
                window.addEventListener("message", listener);
                window.postMessage({ type: "YT_ANALYZER_REQUEST", id: reqId, videoId: videoId }, "*");
            });

            // Se o timeout de 8s disparar, e transcriptData for null
            if (!transcriptData && state.isLoading) {
                 // The promise resolved to null either via timeout or error
            }
        }

        updateLoadingStep(transcriptData ? "Processando vídeo com a IA Gemini..." : "Extraindo transcrição via Nuvem e enviando para IA...");
        
        const payload = { url: url };
        // Envia o texto via extensão p/ api se disponível (bypass Nuvem)
        if (transcriptData) payload.transcript = transcriptData;
        
        const data = await apiCall("/api/analyze", payload);

        state.videoId = data.video_id;
        state.videoUrl = data.video_url;
        state.data = data;
        state.existingIdeas = (data.ideas || []).map(
            (i) => `${i.niche}: ${i.title}`
        );

        renderPresentation(data);
        hideLoading();

        // Scroll to cover
        setTimeout(() => {
            $("#presentation").classList.remove("hidden");
            $("#hero-section").classList.add("hidden");
            $("#cover-section").scrollIntoView({ behavior: "smooth" });
            setupNavLinks();
            observeSections();
        }, 200);
    } catch (err) {
        hideLoading();
        showToast(err.message);
    }
}

// ===== RENDER PRESENTATION =====

function renderPresentation(data) {
    // Cover
    $("#cover-title").textContent = data.title || "Apresentação";
    $("#cover-subtitle").textContent = data.subtitle || "";
    $("#cover-topic-count").textContent = `📝 ${(data.topics || []).length} tópicos`;
    $("#cover-idea-count").textContent = `💡 ${(data.ideas || []).length} ideias`;
    $("#cover-date").textContent = `📅 ${new Date().toLocaleDateString("pt-BR")}`;

    // Topics
    renderTopics(data.topics || []);

    // Workflow
    renderWorkflow(data.workflow || {});

    // Ideas
    renderIdeas(data.ideas || [], "#ideas-grid");

    // Conclusion
    $("#conclusion-text").textContent =
        data.conclusion || "Aplique o que aprendeu!";
    const sourceLink = $("#source-link");
    if (sourceLink) {
        sourceLink.href = data.video_url || "#";
    }
}

function renderTopics(topics) {
    const grid = $("#topics-grid");
    grid.innerHTML = "";

    topics.forEach((topic, i) => {
        const keyword = topic.image_keyword || "technology";
        const imgUrl = `https://source.unsplash.com/240x180/?${encodeURIComponent(keyword)}`;

        const card = document.createElement("div");
        card.className = "topic-card";
        card.style.animationDelay = `${i * 0.08}s`;
        card.innerHTML = `
            <img class="topic-image" src="${imgUrl}" alt="${escapeHtml(topic.title)}" loading="lazy"
                 onerror="this.src='https://placehold.co/240x180/12122a/6c5ce7?text=${encodeURIComponent(keyword)}'">
            <div class="topic-content">
                <div class="topic-number">${i + 1}</div>
                <div class="topic-title">${escapeHtml(topic.title)}</div>
                <div class="topic-description">${escapeHtml(topic.description)}</div>
            </div>`;
        grid.appendChild(card);
    });
}

function renderWorkflow(workflow) {
    const container = $("#workflow-svg");
    if (!container) return;

    const nodes = workflow.nodes || [];
    const edges = workflow.edges || [];

    if (nodes.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem">Workflow não disponível</p>';
        return;
    }

    // Calculate dimensions
    const nodeWidth = 200;
    const nodeHeight = 70;
    const hGap = 60;
    const vGap = 30;
    const cols = Math.min(nodes.length, 4);
    const rows = Math.ceil(nodes.length / cols);
    const svgWidth = cols * (nodeWidth + hGap) + hGap;
    const svgHeight = rows * (nodeHeight + vGap) + vGap + 40;

    // Build node positions (snake pattern for nice flow)
    const positions = {};
    nodes.forEach((node, i) => {
        const row = Math.floor(i / cols);
        const colInRow = i % cols;
        const col = row % 2 === 0 ? colInRow : cols - 1 - colInRow;
        const x = hGap + col * (nodeWidth + hGap);
        const y = vGap + 20 + row * (nodeHeight + vGap);
        positions[node.id] = { x, y, cx: x + nodeWidth / 2, cy: y + nodeHeight / 2 };
    });

    let svg = `<svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="workflow-svg" xmlns="http://www.w3.org/2000/svg">`;

    // Defs
    svg += `<defs>
        <linearGradient id="wf-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#6c5ce7"/>
            <stop offset="100%" style="stop-color:#a855f7"/>
        </linearGradient>
        <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#6c5ce7" opacity="0.7"/>
        </marker>
    </defs>`;

    // Edges
    edges.forEach((edge) => {
        const from = positions[edge.from];
        const to = positions[edge.to];
        if (!from || !to) return;

        const dx = to.cx - from.cx;
        const dy = to.cy - from.cy;
        const ctrl1x = from.cx + dx * 0.4;
        const ctrl1y = from.cy;
        const ctrl2x = to.cx - dx * 0.4;
        const ctrl2y = to.cy;

        svg += `<path d="M${from.cx},${from.cy + nodeHeight / 2} C${ctrl1x},${from.cy + nodeHeight / 2 + 30} ${ctrl2x},${to.cy - nodeHeight / 2 - 30} ${to.cx},${to.cy - nodeHeight / 2}"
            fill="none" stroke="#6c5ce7" stroke-width="2" stroke-opacity="0.4" marker-end="url(#arrow)"/>`;

        if (edge.label) {
            const midX = (from.cx + to.cx) / 2;
            const midY = (from.cy + to.cy) / 2;
            svg += `<text x="${midX}" y="${midY}" text-anchor="middle" fill="#a0a0c0" font-size="10" font-family="Inter">${escapeHtml(edge.label)}</text>`;
        }
    });

    // Nodes
    nodes.forEach((node) => {
        const pos = positions[node.id];
        if (!pos) return;

        svg += `<g>
            <rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}" rx="12" ry="12"
                fill="rgba(255,255,255,0.04)" stroke="url(#wf-grad)" stroke-width="1.5"/>
            <text x="${pos.x + nodeWidth / 2}" y="${pos.y + 28}" text-anchor="middle"
                fill="#f0f0ff" font-size="13" font-weight="600" font-family="Inter">${escapeHtml(truncate(node.label, 24))}</text>
            <text x="${pos.x + nodeWidth / 2}" y="${pos.y + 48}" text-anchor="middle"
                fill="#a0a0c0" font-size="10" font-family="Inter">${escapeHtml(truncate(node.description || "", 30))}</text>
        </g>`;
    });

    svg += "</svg>";
    container.innerHTML = svg;
}

function renderIdeas(ideas, gridSelector) {
    const grid = $(gridSelector);
    ideas.forEach((idea, i) => {
        const card = document.createElement("div");
        card.className = "idea-card";
        card.style.animationDelay = `${i * 0.06}s`;
        card.innerHTML = `
            <div class="idea-icon">${idea.icon || "💡"}</div>
            <div class="idea-niche">${escapeHtml(idea.niche)}</div>
            <div class="idea-title">${escapeHtml(idea.title)}</div>
            <div class="idea-description">${escapeHtml(idea.description)}</div>
            <button class="btn-skill" onclick='generateSkillPrompt(${JSON.stringify(idea).replace(/'/g, "&#39;")})'>
                ⚡ Prompt de Skill
            </button>`;
        grid.appendChild(card);
    });
}

// ===== LOAD MORE IDEAS =====

async function loadMoreIdeas() {
    const btn = $("#btn-more-ideas");
    btn.disabled = true;
    btn.textContent = "⏳ Gerando ideias...";

    try {
        const result = await apiCall("/api/more-ideas", {
            video_id: state.videoId,
            existing_ideas: state.existingIdeas,
        });

        const newIdeas = result.ideas || [];
        state.existingIdeas.push(
            ...newIdeas.map((i) => `${i.niche}: ${i.title}`)
        );
        renderIdeas(newIdeas, "#ideas-grid");

        // Update counter
        const countEl = $("#ideas-count");
        if (countEl) {
            const total = $$("#ideas-grid .idea-card").length;
            countEl.textContent = `${total} ideias geradas`;
        }
    } catch (err) {
        showToast(err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = "➕ Carregar mais 10 ideias";
    }
}

// ===== NICHE IDEAS =====

async function searchNicheIdeas() {
    const input = $("#niche-input");
    const niche = input.value.trim();
    if (!niche) {
        showToast("Digite um nicho ou segmento de negócio");
        return;
    }

    const btn = $("#btn-niche-search");
    btn.disabled = true;
    btn.textContent = "⏳ Gerando...";

    try {
        const result = await apiCall("/api/niche-ideas", {
            video_id: state.videoId,
            niche,
        });

        const grid = $("#niche-ideas-grid");
        grid.innerHTML = "";
        renderIdeas(result.ideas || [], "#niche-ideas-grid");
    } catch (err) {
        showToast(err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = "🔍 Buscar ideias";
    }
}

// ===== SKILL PROMPT =====

async function generateSkillPrompt(idea) {
    // Open a new window immediately (user gesture context)
    const newWindow = window.open("", "_blank");
    newWindow.document.write(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Gerando Prompt de Skill...</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Inter', sans-serif;
                background: #0a0a1a;
                color: #f0f0ff;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .loading { text-align: center; }
            .spinner {
                width: 40px; height: 40px;
                border: 3px solid rgba(255,255,255,0.1);
                border-top-color: #a855f7;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                margin: 0 auto 1rem;
            }
            @keyframes spin { to { transform: rotate(360deg); } }
            .prompt-page { max-width: 900px; margin: 0 auto; padding: 3rem 2rem; }
            .prompt-header h1 {
                font-size: 1.8rem; font-weight: 800; margin-bottom: 0.5rem;
                background: linear-gradient(135deg, #6c5ce7, #a855f7, #ec4899);
                -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            }
            .prompt-header p { color: #a0a0c0; margin-bottom: 1.5rem; font-size: 0.95rem; }
            .prompt-box {
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 16px;
                padding: 2rem;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.88rem;
                line-height: 1.9;
                color: #a0a0c0;
                white-space: pre-wrap;
                word-wrap: break-word;
            }
            .btn-copy {
                background: linear-gradient(135deg, #6c5ce7, #a855f7, #ec4899);
                border: none; color: white; padding: 12px 28px;
                border-radius: 50px; cursor: pointer; font-family: inherit;
                font-size: 0.9rem; font-weight: 600; margin-top: 1.5rem;
                transition: all 0.3s ease;
            }
            .btn-copy:hover { box-shadow: 0 4px 20px rgba(108, 92, 231, 0.4); }
            .copied { background: #22c55e !important; }
        </style>
    </head>
    <body>
        <div class="loading">
            <div class="spinner"></div>
            <p>Gerando prompt de skill com IA...</p>
        </div>
    </body>
    </html>`);

    try {
        const result = await apiCall("/api/skill-prompt", {
            video_id: state.videoId,
            idea,
        });

        const skillName = result.skill_name || idea.title;
        const skillPrompt = result.skill_prompt || "Erro ao gerar prompt";

        newWindow.document.body.innerHTML = `
        <div class="prompt-page">
            <div class="prompt-header">
                <h1>⚡ ${escapeHtml(skillName)}</h1>
                <p>Prompt completo para criar esta skill de IA. Copie e use no seu assistente favorito.</p>
            </div>
            <div class="prompt-box" id="prompt-text">${escapeHtml(skillPrompt)}</div>
            <button class="btn-copy" onclick="copyPrompt()">📋 Copiar Prompt</button>
        </div>`;

        newWindow.document.title = `Skill: ${skillName}`;

        // Inject copy function
        newWindow.eval(`
            function copyPrompt() {
                const text = document.getElementById('prompt-text').textContent;
                navigator.clipboard.writeText(text).then(() => {
                    const btn = document.querySelector('.btn-copy');
                    btn.textContent = '✅ Copiado!';
                    btn.classList.add('copied');
                    setTimeout(() => {
                        btn.textContent = '📋 Copiar Prompt';
                        btn.classList.remove('copied');
                    }, 2000);
                });
            }
        `);
    } catch (err) {
        newWindow.document.body.innerHTML = `
        <div class="prompt-page">
            <div class="prompt-header">
                <h1>❌ Erro</h1>
                <p>${escapeHtml(err.message)}</p>
            </div>
        </div>`;
    }
}

// ===== UI UTILITIES =====

function showLoading(text) {
    state.isLoading = true;
    const overlay = $("#loading-overlay");
    overlay.classList.add("active");
    updateLoadingStep(text);
}

function updateLoadingStep(text) {
    const el = $("#loading-step");
    if (el) el.textContent = text;
}

function hideLoading() {
    state.isLoading = false;
    $("#loading-overlay").classList.remove("active");
}

function showToast(message) {
    let toast = $("#toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        toast.className = "toast";
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 4000);
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
}

function truncate(text, max) {
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

// ===== PDF EXPORT =====

function exportToPDF() {
    const btn = $("#btn-export-pdf");
    const originalText = btn.innerHTML;
    btn.innerHTML = "⏳ Gerando...";
    btn.disabled = true;

    const element = $("#presentation");
    
    // Hide buttons dynamically
    const actions = document.querySelector(".presentation-actions");
    if (actions) actions.style.display = "none";
    const moreBtn = $("#btn-more-ideas");
    if (moreBtn) moreBtn.style.display = "none";
    const nicheSearch = document.querySelector(".niche-search");
    if (nicheSearch) nicheSearch.style.display = "none";

    const opt = {
        margin: [15, 15, 15, 15],
        filename: `Analise_YouTube_${state.videoId || 'Video'}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#0a0a1a" },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        btn.innerHTML = originalText;
        btn.disabled = false;
        // Restore buttons
        if (actions) actions.style.display = "flex";
        if (moreBtn) moreBtn.style.display = "block";
        if (nicheSearch) nicheSearch.style.display = "block";
        showToast("PDF salvo com sucesso!");
    });
}

// ===== LIBRARY (SAVED ANALYSES) =====

function toggleLibrary() {
    const modal = $("#library-modal");
    if (modal.classList.contains("hidden")) {
        modal.classList.remove("hidden");
        renderLibrary();
    } else {
        modal.classList.add("hidden");
    }
}

function saveToLibrary() {
    if (!state.data) return;
    
    let history = [];
    try {
        history = JSON.parse(localStorage.getItem('ytHelper_history') || '[]');
    } catch (e) {}

    const exists = history.find(h => h.video_id === state.data.video_id);
    if (!exists) {
        state.data.savedAt = new Date().toISOString();
        history.unshift(state.data);
        localStorage.setItem('ytHelper_history', JSON.stringify(history));
        showToast("Análise salva na Biblioteca de acessos rápidos!");
    } else {
        showToast("Esta análise já está na sua Biblioteca.");
    }
}

function renderLibrary() {
    const grid = $("#library-grid");
    const emptyMsg = $("#library-empty");
    
    let history = [];
    try {
        history = JSON.parse(localStorage.getItem('ytHelper_history') || '[]');
    } catch (e) {}

    if (history.length === 0) {
        grid.style.display = "none";
        emptyMsg.style.display = "block";
        return;
    }

    grid.style.display = "grid";
    emptyMsg.style.display = "none";
    grid.innerHTML = "";

    history.forEach((item, index) => {
        const card = document.createElement("div");
        card.className = "topic-card"; 
        card.style.cursor = "pointer";
        card.style.position = "relative";
        
        const dateStr = item.savedAt ? new Date(item.savedAt).toLocaleDateString('pt-BR') : 'Hoje';
        
        card.innerHTML = `
            <img class="topic-image" src="https://img.youtube.com/vi/${item.video_id}/mqdefault.jpg" alt="Thumbnail" loading="lazy">
            <div class="topic-content">
                <div class="topic-title" style="font-size:0.95rem; margin-bottom:0.5rem">${escapeHtml(truncate(item.title || "Vídeo Salvo", 50))}</div>
                <div class="topic-description" style="font-size:0.8rem">Salvo em: ${dateStr}</div>
            </div>
            <button onclick="deleteFromLibrary(event, ${index})" style="position:absolute; top:8px; right:8px; background:rgba(0,0,0,0.6); color:white; border:none; border-radius:50%; width:24px; height:24px; cursor:pointer;" title="Remover">✕</button>
        `;
        
        card.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            loadFromLibrary(item);
        });
        
        grid.appendChild(card);
    });
}

function deleteFromLibrary(e, index) {
    e.stopPropagation();
    let history = JSON.parse(localStorage.getItem('ytHelper_history') || '[]');
    history.splice(index, 1);
    localStorage.setItem('ytHelper_history', JSON.stringify(history));
    renderLibrary();
    showToast("Análise removida da Biblioteca.");
}

function loadFromLibrary(data) {
    toggleLibrary();
    
    state.videoId = data.video_id;
    state.videoUrl = data.video_url;
    state.data = data;
    state.existingIdeas = (data.ideas || []).map(i => `${i.niche}: ${i.title}`);
    
    renderPresentation(data);
    
    $("#presentation").classList.remove("hidden");
    $("#hero-section").classList.add("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
    setupNavLinks();
    observeSections();
    showToast("Análise carregada do cache!");
}

// ===== NAVIGATION =====

function setupNavLinks() {
    const sections = [
        { id: "cover-section", label: "Capa" },
        { id: "topics-section", label: "Resumo" },
        { id: "workflow-section", label: "Workflow" },
        { id: "ideas-section", label: "Ideias" },
        { id: "conclusion-section", label: "Conclusão" },
    ];

    const nav = $("#nav-links");
    nav.innerHTML = "";
    sections.forEach((s) => {
        const btn = document.createElement("button");
        btn.className = "nav-link";
        btn.textContent = s.label;
        btn.dataset.section = s.id;
        btn.addEventListener("click", () => {
            const el = $(`#${s.id}`);
            if (el) el.scrollIntoView({ behavior: "smooth" });
        });
        nav.appendChild(btn);
    });
}

function observeSections() {
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("visible");
                    // Update active nav
                    $$(".nav-link").forEach((l) => l.classList.remove("active"));
                    const link = $(`.nav-link[data-section="${entry.target.id}"]`);
                    if (link) link.classList.add("active");
                }
            });
        },
        { threshold: 0.15 }
    );

    $$(".section, .cover-info, .conclusion").forEach((el) => {
        observer.observe(el);
    });
}

// ===== NEW ANALYSIS =====

function newAnalysis() {
    $("#hero-section").classList.remove("hidden");
    $("#presentation").classList.add("hidden");
    $("#url-input").value = "";
    $("#url-input").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// ===== EVENT LISTENERS =====

document.addEventListener("DOMContentLoaded", () => {
    // Enter key on URL input
    const input = $("#url-input");
    if (input) {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") analyzeVideo();
        });
    }

    // Enter key on niche input
    const nicheInput = $("#niche-input");
    if (nicheInput) {
        nicheInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") searchNicheIdeas();
        });
    }
});
