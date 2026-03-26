#!/usr/bin/env python3
"""
YouTube Video Web Application - Backend
========================================
Flask server that provides API endpoints for YouTube video analysis,
business idea generation, and skill prompt creation using Gemini AI.
"""

import json
import os
import re
import sys
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory

try:
    from youtube_transcript_api import YouTubeTranscriptApi
except ImportError:
    print("❌ pip install youtube-transcript-api")
    sys.exit(1)

try:
    from google import genai
except ImportError:
    print("❌ pip install google-genai")
    sys.exit(1)


app = Flask(__name__, static_folder="static", template_folder="static")

API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"


# ========== HELPERS ==========

def get_client():
    key = API_KEY or os.environ.get("GEMINI_API_KEY", "")
    if not key:
        raise RuntimeError("GEMINI_API_KEY não configurada")
    return genai.Client(api_key=key)


def extract_video_id(url: str) -> str:
    patterns = [
        r'(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/v/|youtube\.com/shorts/)([a-zA-Z0-9_-]{11})',
        r'^([a-zA-Z0-9_-]{11})$',
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    raise ValueError("URL inválida")


def get_transcript(video_id: str, lang: str = "pt") -> str:
    ytt = YouTubeTranscriptApi()
    langs = [lang]
    if lang != "pt":
        langs.append("pt")
    if "en" not in langs:
        langs.append("en")

    try:
        entries = ytt.fetch(video_id, languages=langs)
        return _join(entries)
    except Exception:
        pass

    try:
        for t in ytt.list(video_id):
            try:
                return _join(t.fetch())
            except Exception:
                continue
    except Exception as e:
        raise RuntimeError(f"Sem transcrição: {e}")

    raise RuntimeError("Nenhuma transcrição disponível")


def _join(entries) -> str:
    parts = []
    for e in entries:
        text = e.get("text", "") if isinstance(e, dict) else getattr(e, "text", str(e))
        text = text.strip()
        if text and text not in ("[Music]", "[Música]", "[Aplausos]", "[♪♪♪]"):
            parts.append(text)
    return " ".join(parts)


def call_gemini(prompt: str) -> dict:
    client = get_client()
    resp = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
    raw = resp.text.strip()
    if raw.startswith("```"):
        raw = re.sub(r'^```(?:json)?\s*\n?', '', raw)
        raw = re.sub(r'\n?```\s*$', '', raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r'\{[\s\S]*\}', raw)
        if m:
            return json.loads(m.group())
        raise RuntimeError(f"JSON inválido: {raw[:300]}")


# ========== PROMPTS ==========

ANALYZE_PROMPT = """Você é um especialista em análise de conteúdo e estratégia de negócios.
Analise a transcrição abaixo e responda EXCLUSIVAMENTE em JSON válido (sem markdown).

Formato:
{{
  "title": "Título descritivo do vídeo",
  "subtitle": "Frase resumindo o tema (máx 2 linhas)",
  "topics": [
    {{
      "title": "Título do tópico",
      "description": "Explicação clara (2-4 frases)",
      "image_keyword": "Palavra-chave em inglês para buscar imagem de referência no Unsplash (1-2 palavras, ex: 'automation', 'data analysis', 'marketing strategy')"
    }}
  ],
  "workflow": {{
    "nodes": [
      {{ "id": "1", "label": "Nome do passo", "description": "Breve descrição" }}
    ],
    "edges": [
      {{ "from": "1", "to": "2", "label": "relação opcional" }}
    ]
  }},
  "ideas": [
    {{
      "niche": "Nome do nicho/setor",
      "icon": "emoji representando o nicho",
      "title": "Título da ideia",
      "description": "Como aplicar na prática (2-3 frases)"
    }}
  ],
  "conclusion": "Mensagem motivacional de conclusão (2-3 frases)"
}}

Regras:
1. Gere 5-15 tópicos de resumo com image_keyword relevante em inglês
2. Gere EXATAMENTE 10 ideias de negócio em nichos DIVERSOS
3. O workflow deve ter 4-8 nós mostrando o fluxo lógico das ideias/pontos do vídeo
4. Todas as explicações em português do Brasil
5. Tópicos em ordem cronológica do vídeo
6. Ideias criativas, específicas e acionáveis

TRANSCRIÇÃO:
{transcript}"""

MORE_IDEAS_PROMPT = """Você é um especialista em estratégia de negócios.
Com base no seguinte conteúdo de vídeo, gere EXATAMENTE 10 NOVAS ideias de aplicação prática em negócios.

IMPORTANTE: As ideias devem ser COMPLETAMENTE DIFERENTES das já geradas anteriormente.
Ideias já geradas (NÃO repetir estes nichos/títulos):
{existing_ideas}

Responda EXCLUSIVAMENTE em JSON:
{{
  "ideas": [
    {{
      "niche": "Nome do nicho/setor",
      "icon": "emoji",
      "title": "Título da ideia",
      "description": "Como aplicar na prática (2-3 frases)"
    }}
  ]
}}

Regras:
1. 10 ideias em nichos DIFERENTES dos já listados
2. Criativas, específicas e acionáveis
3. Português do Brasil

RESUMO DO VÍDEO:
{summary}"""

NICHE_IDEAS_PROMPT = """Você é um especialista em estratégia de negócios.
Com base no seguinte conteúdo de vídeo, gere EXATAMENTE 10 ideias de aplicação prática
ESPECIFICAMENTE para o nicho/negócio: "{niche}"

Responda EXCLUSIVAMENTE em JSON:
{{
  "ideas": [
    {{
      "niche": "{niche}",
      "icon": "emoji representando a ideia",
      "title": "Título da ideia",
      "description": "Como aplicar na prática (2-3 frases)"
    }}
  ]
}}

Regras:
1. Todas as 10 ideias devem ser relevantes para o nicho "{niche}"
2. Cada ideia deve ter um foco diferente dentro do nicho
3. Criativas, específicas e acionáveis
4. Português do Brasil

RESUMO DO VÍDEO:
{summary}"""

SKILL_PROMPT_TEMPLATE = """Você é um especialista em criar prompts de Skills para IA.
Gere um prompt COMPLETO e ESTRUTURADO para criação de uma Skill de IA baseada na seguinte ideia de negócio.

Ideia:
- Nicho: {niche}
- Título: {title}
- Descrição: {description}

Contexto do vídeo original: {summary}

Responda EXCLUSIVAMENTE em JSON:
{{
  "skill_name": "Nome da Skill (curto e descritivo)",
  "skill_prompt": "O prompt completo e estruturado aqui. Deve incluir:\\n1. PAPEL: Definição do papel da IA\\n2. CONTEXTO: Contexto da skill\\n3. OBJETIVO: O que a skill deve fazer\\n4. INPUTS: Quais informações o usuário fornece\\n5. PROCESSO: Passo a passo do que a IA deve executar\\n6. OUTPUT: Formato e estrutura da saída\\n7. REGRAS: Regras e restrições\\n8. EXEMPLOS: Pelo menos 1 exemplo de uso\\n\\nO prompt deve ser longo, detalhado e profissional."
}}"""


# ========== SESSION STORE (in-memory) ==========
sessions = {}


# ========== ROUTES ==========

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/analyze", methods=["POST"])
def analyze():
    data = request.json or {}
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "URL não fornecida"}), 400

    try:
        video_id = extract_video_id(url)
        transcript = get_transcript(video_id)

        # Truncate if too long
        if len(transcript) > 80000:
            transcript = transcript[:80000]

        prompt = ANALYZE_PROMPT.format(transcript=transcript)
        result = call_gemini(prompt)

        # Store session data for follow-up requests
        summary_text = f"Título: {result.get('title', '')}. "
        summary_text += " ".join(t.get("title", "") + ": " + t.get("description", "") for t in result.get("topics", []))
        sessions[video_id] = {
            "summary": summary_text[:5000],
            "existing_ideas": [f"{i.get('niche')}: {i.get('title')}" for i in result.get("ideas", [])],
        }

        result["video_id"] = video_id
        result["video_url"] = f"https://www.youtube.com/watch?v={video_id}"
        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/more-ideas", methods=["POST"])
def more_ideas():
    data = request.json or {}
    video_id = data.get("video_id", "")
    existing = data.get("existing_ideas", [])

    session = sessions.get(video_id, {})
    if not session:
        return jsonify({"error": "Análise não encontrada. Analise um vídeo primeiro."}), 400

    # Merge existing ideas from client + server
    all_existing = list(set(session.get("existing_ideas", []) + existing))

    prompt = MORE_IDEAS_PROMPT.format(
        existing_ideas="\n".join(f"- {x}" for x in all_existing),
        summary=session["summary"],
    )

    try:
        result = call_gemini(prompt)
        new_ideas = result.get("ideas", [])

        # Update session
        session["existing_ideas"] = all_existing + [f"{i.get('niche')}: {i.get('title')}" for i in new_ideas]

        return jsonify({"ideas": new_ideas})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/niche-ideas", methods=["POST"])
def niche_ideas():
    data = request.json or {}
    video_id = data.get("video_id", "")
    niche = data.get("niche", "").strip()

    if not niche:
        return jsonify({"error": "Nicho não fornecido"}), 400

    session = sessions.get(video_id, {})
    if not session:
        return jsonify({"error": "Análise não encontrada. Analise um vídeo primeiro."}), 400

    prompt = NICHE_IDEAS_PROMPT.format(niche=niche, summary=session["summary"])

    try:
        result = call_gemini(prompt)
        return jsonify({"ideas": result.get("ideas", [])})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/skill-prompt", methods=["POST"])
def skill_prompt():
    data = request.json or {}
    video_id = data.get("video_id", "")
    idea = data.get("idea", {})

    session = sessions.get(video_id, {})
    summary = session.get("summary", data.get("summary", ""))

    prompt = SKILL_PROMPT_TEMPLATE.format(
        niche=idea.get("niche", ""),
        title=idea.get("title", ""),
        description=idea.get("description", ""),
        summary=summary[:3000],
    )

    try:
        result = call_gemini(prompt)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    if not os.environ.get("GEMINI_API_KEY"):
        print("⚠️  Configure GEMINI_API_KEY antes de iniciar")
        print("   export GEMINI_API_KEY='sua-chave'")
        sys.exit(1)
    port = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    print(f"🚀 Servidor rodando em http://localhost:{port}")
    app.run(debug=debug, host="0.0.0.0", port=port)

