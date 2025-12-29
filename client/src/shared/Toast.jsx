import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'

export default function ToastContainer() {
  const [messages, setMessages] = useState([])

  useEffect(() => {
    window.showMessage = (type, text, timeout = 3000) => {
      const id = Date.now() + Math.random()
      setMessages(m => [...m, { id, type, text }])
      setTimeout(() => setMessages(m => m.filter(mm => mm.id !== id)), timeout)
    }
    return () => { window.showMessage = null }
  }, [])

  return (
    <div style={{ position: 'fixed', right: 16, top: 16, zIndex: 9999 }}>
      {messages.map(m => (
        <div key={m.id} style={{ marginBottom: 8, padding: '10px 14px', borderRadius: 8, boxShadow: '0 2px 6px rgba(0,0,0,0.12)', background: m.type === 'error' ? '#fee2e2' : (m.type === 'success' ? '#dcfce7' : '#eef2ff'), color: m.type === 'error' ? '#b91c1c' : '#0f172a', minWidth: 200 }}>
          {m.text}
        </div>
      ))}
    </div>
  )
}
