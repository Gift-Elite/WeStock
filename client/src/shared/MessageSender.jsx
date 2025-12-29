import React, { useState } from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000'

export default function MessageSender({ roleLabel = '' }) {
  const [text, setText] = useState('')
  async function send() {
    if (!text) return
    try {
      const token = localStorage.getItem('token')
      await axios.post(API + '/api/messages', { message: text }, { headers: { Authorization: `Bearer ${token}` } })
      window.showMessage && window.showMessage('success', 'Message sent')
      setText('')
    } catch (e) { console.error(e); window.showMessage && window.showMessage('error', 'Failed to send') }
  }
  return (
    <div className="flex gap-2">
      <input placeholder={roleLabel ? `Message from ${roleLabel}` : 'Message'} value={text} onChange={e=>setText(e.target.value)} className="flex-1 border p-2 rounded" />
      <button className="px-3 py-2 bg-indigo-600 text-white rounded" onClick={send}>Send</button>
    </div>
  )
}
