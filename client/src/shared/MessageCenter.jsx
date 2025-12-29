import React, { useEffect, useState } from 'react'
import { io } from 'socket.io-client'

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000'

export default function MessageCenter() {
  const [messages, setMessages] = useState([])

  useEffect(() => {
    const socket = io(API)
    socket.on('connect', () => console.log('MessageCenter socket connected', socket.id))
    socket.on('global:message', data => {
      setMessages(prev => [data, ...prev].slice(0, 50))
    })
    return () => { socket.disconnect() }
  }, [])

  function dismiss(indexOrId) {
    setMessages(prev => prev.filter((m, i) => {
      if (typeof indexOrId === 'number') return i !== indexOrId
      return (m.id || m._id || i) !== indexOrId
    }))
  }

  return (
    <div aria-live="polite" className="fixed right-4 bottom-4 z-50 w-80 space-y-2">
      {messages.map((m, idx) => {
        const key = m.id ?? m._id ?? idx
        return (
          <div key={key} className="bg-white p-3 rounded shadow border relative">
            <button aria-label="dismiss" onClick={() => dismiss(key)} className="absolute right-2 top-2 scale-125 text-red-600 hover:text-slate-600">×</button>
            <div className="text-xs text-slate-400">{m.from_role} · {m.from_name} · {m.created_at ? new Date(m.created_at).toLocaleTimeString() : ''}</div>
            <div className="mt-1 text-sm">{m.message}</div>
          </div>
        )
      })}
    </div>
  )
}
