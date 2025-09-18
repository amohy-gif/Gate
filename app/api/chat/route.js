import axios from 'axios'
import { NextResponse } from 'next/server'

/**
 * Helper: call Gemini (Generative Language API - simple usage)
 * Using the REST generateContent endpoint with key as query param.
 */
async function callGemini(prompt) {
  try {
    const res = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
      { 
        // simple payload - ask Gemini to include possible structured hints (like JSON) for scripts/video
        prompt: {
          text: prompt
        },
        // alternative format if needed below:
        // contents: [{ parts: [{ text: prompt }] }]
      },
      {
        headers: { 'Content-Type': 'application/json' },
        params: { key: process.env.GEMINI_API_KEY }
      }
    )
    // Try to extract text variants
    const raw = res.data
    // Different Gemini responses can vary; attempt multiple paths:
    const candidate = raw?.candidates?.[0]?.content?.parts?.[0]?.text
    if (candidate) return { ok: true, text: candidate, raw }
    // fallback: some responses may be under 'output' fields
    return { ok: true, text: JSON.stringify(raw), raw }
  } catch (err) {
    console.error('Gemini error', err?.response?.data || err.message)
    return { ok: false, error: err?.response?.data || err.message }
  }
}

/**
 * Helper: call OpenAI chat completions (gpt-4o-mini or other)
 */
async function callOpenAI(prompt) {
  if (!process.env.OPENAI_API_KEY) return { ok: false, error: 'OPENAI_API_KEY missing' }
  try {
    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1200,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    )
    const text = res.data?.choices?.[0]?.message?.content
    return { ok: true, text, raw: res.data }
  } catch (err) {
    console.error('OpenAI error', err?.response?.data || err.message)
    return { ok: false, error: err?.response?.data || err.message }
  }
}

/**
 * Simple heuristic merger (fallback if no OpenAI summarizer):
 * - Try to detect JSON in outputs; if JSON -> merge fields
 * - If outputs mention keywords (SCRIPT, VIDEO, ASSETS) split into sections
 * - Otherwise concatenate and prefer longer/more-detailed response
 */
function heuristicMerge(geminiText, openaiText) {
  // try parse JSON from either
  try {
    const gjson = JSON.parse(geminiText)
    const ojson = JSON.parse(openaiText)
    return JSON.stringify({ merged: { gemini: gjson, openai: ojson } }, null, 2)
  } catch (e) {
    // not JSON
  }

  // detect common markers
  const markers = ['SCRIPT:', 'VIDEO:', 'ASSETS:', 'TRANSCRIPT:']
  const parts = { script: '', video: '', general: '' }

  const extractByMarker = (txt) => {
    for (const m of markers) {
      if (txt.toUpperCase().includes(m)) {
        const idx = txt.toUpperCase().indexOf(m)
        const segment = txt.slice(idx + m.length).trim()
        if (m.startsWith('SCRIPT')) parts.script += '\n' + segment
        else if (m.startsWith('VIDEO')) parts.video += '\n' + segment
        else parts.general += '\n' + segment
      }
    }
  }

  extractByMarker(geminiText || '')
  extractByMarker(openaiText || '')

  // if nothing found, choose longer + annotate source
  if (!parts.script && !parts.video && !parts.general) {
    const prefer = (openaiText || '').length >= (geminiText || '').length ? openaiText : geminiText
    return `--Merged result (heuristic)--\n\n[From Gemini]\n${geminiText || '(no reply)'}\n\n[From OpenAI]\n${openaiText || '(no reply)'}\n\n[Preferred]\n${prefer}\n`
  }

  // build result
  let out = '--Merged Result (heuristic)--\n'
  if (parts.script) out += `\n== Script ==\n${parts.script}\n`
  if (parts.video) out += `\n== Video Instructions / Assets ==\n${parts.video}\n`
  if (parts.general) out += `\n== Other ==\n${parts.general}\n`
  return out
}

/**
 * If OPENAI_API_KEY exists, we can call OpenAI to "synthesize" best answer
 * given the two outputs. We craft a system prompt instructing it to combine.
 */
async function synthesizeWithOpenAI(geminiText, openaiText, userPrompt) {
  if (!process.env.OPENAI_API_KEY) return { ok: false, error: 'OPENAI_API_KEY missing' }
  const synthPrompt = `
You are a synthesizer. The user asked:
"""${userPrompt}"""

Gemini replied:
"""${geminiText}"""

OpenAI replied:
"""${openaiText}"""

Return a single, best possible combined response. 
- If one response contains a script and the other contains video instructions, produce JSON with fields: {"script": "...", "video_instructions": "...", "notes": "..."}.
- If both are text answers, produce a merged concise answer and present any concrete artifacts (code blocks, scripts, or step lists).
- Keep output machine-friendly: if needed return JSON. Otherwise return well-structured Arabic text.
`

  try {
    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: synthPrompt }],
        max_tokens: 1200
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    )
    const text = res.data?.choices?.[0]?.message?.content
    return { ok: true, text }
  } catch (err) {
    console.error('Synthesis OpenAI error', err?.response?.data || err.message)
    return { ok: false, error: err?.response?.data || err.message }
  }
}

export async function POST(req) {
  try {
    const { prompt, mode = 'fusion', model = 'both' } = await req.json()

    // Decide which calls to make
    const wantGemini = model === 'both' || model === 'gemini'
    const wantOpenAI = (model === 'both' || model === 'openai') && !!process.env.OPENAI_API_KEY

    // Parallel calls
    const calls = []
    if (wantGemini) calls.push(callGemini(prompt))
    if (model === 'openai' || (model === 'both' && process.env.OPENAI_API_KEY)) calls.push(callOpenAI(prompt))
    // If user requested OpenAI but no key available we still allow OpenAI call to fail and continue.

    // Execute parallel
    const results = await Promise.all(calls)

    // Map results
    let gemT = '', openT = ''
    let gemOk = false, openOk = false
    for (const r of results) {
      if (!r) continue
      if (r.raw && r.raw?.candidates) { gemOk = r.ok; gemT = r.text || '' }
      else if (r.raw && r.raw?.choices) { openOk = r.ok; openT = r.text || '' }
      else {
        // best-guess: if any result contains 'candidates' likely Gemini; else OpenAI
        if (r.text && r.text.length > 0 && !openT) {
          if (!gemT) { gemT = r.text; gemOk = r.ok }
          else { openT = r.text; openOk = r.ok }
        }
      }
    }

    // If mode is single and model specified, return the corresponding text
    if (mode === 'single') {
      if (model === 'gemini') return NextResponse.json({ reply: gemT || 'لا رد من Gemini' })
      if (model === 'openai') return NextResponse.json({ reply: openT || 'لا رد من OpenAI' })
      // both fallback
      const any = openT || gemT || 'لا رد'
      return NextResponse.json({ reply: any })
    }

    // Fusion mode: prefer to synthesize using OpenAI synthesizer if key exists
    if (process.env.OPENAI_API_KEY && (gemT || openT)) {
      // call synthesize
      const synth = await synthesizeWithOpenAI(gemT, openT, prompt)
      if (synth.ok) {
        return NextResponse.json({ reply: synth.text })
      } else {
        // fallback to heuristic
        const fallback = heuristicMerge(gemT, openT)
        return NextResponse.json({ reply: fallback })
      }
    } else {
      // no OpenAI key: fallback heuristic merge
      const merged = heuristicMerge(gemT, openT)
      return NextResponse.json({ reply: merged })
    }
  } catch (err) {
    console.error('API route error', err?.response?.data || err.message)
    return NextResponse.json({ reply: '⚠️ حدث خطأ في المعالجة' }, { status: 500 })
  }
    }
