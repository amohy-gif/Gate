'use client'
import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

export default function Chat() {
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aihub_fusion_msgs')||'[]') } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('fusion') // 'fusion' or 'single'
  const [model, setModel] = useState('both') // 'both'|'gemini'|'openai'
  const endRef = useRef(null)

  useEffect(() => { localStorage.setItem('aihub_fusion_msgs', JSON.stringify(messages)) }, [messages])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  async function send() {
    if (!input.trim()) return
    const userMsg = { id: Date.now(), role: 'user', text: input }
    setMessages(prev=>[...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await axios.post('/api/chat', {
        prompt: input,
        mode,      // fusion or single
        model     // both / gemini / openai
      })
      const reply = res.data?.reply || 'لم يصل رد.'
      setMessages(prev=>[...prev, { id: Date.now()+1, role: 'assistant', text: reply }])
    } catch (err) {
      console.error(err)
      setMessages(prev=>[...prev, { id: Date.now()+2, role: 'assistant', text: 'حدث خطأ أثناء طلب النموذج.' }])
    } finally { setLoading(false) }
  }

  function clearChat(){ setMessages([]); localStorage.removeItem('aihub_fusion_msgs') }

  return (
    <div className="bg-white rounded-xl shadow p-4 flex flex-col h-[80vh]">
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-bold text-lg">AI Hub Fusion</h1>
        <div className="flex gap-2 items-center">
          <select value={mode} onChange={e=>setMode(e.target.value)} className="border p-1 rounded">
            <option value="fusion">تجميع (Fusion)</option>
            <option value="single">استدعاء واحد</option>
          </select>
          <select value={model} onChange={e=>setModel(e.target.value)} className="border p-1 rounded">
            <option value="both">كلاهما (Gemini + OpenAI)</option>
            <option value="gemini">Gemini فقط</option>
            <option value="openai">OpenAI فقط</option>
          </select>
          <button onClick={clearChat} className="text-sm text-red-600">مسح</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-3 border rounded">
        {messages.map(m=>(
          <div key={m.id} className={`max-w-[85%] ${m.role==='user'?'ml-auto text-right':'mr-auto text-left'}`}>
            <div className={`${m.role==='user'?'bg-blue-500 text-white':'bg-gray-100 text-gray-900'} p-3 rounded-lg`}>{m.text}</div>
          </div>
        ))}
        {loading && <div className="text-gray-500">جارِ معالجة الطلب...</div>}
        <div ref={endRef}></div>
      </div>

      <div className="mt-3 flex gap-2">
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') send() }} placeholder="اكتب سؤالك..." className="flex-1 border p-2 rounded" />
        <button onClick={send} disabled={loading} className="bg-green-600 text-white px-4 py-2 rounded">إرسال</button>
      </div>
    </div>
  )
}
