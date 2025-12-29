import React, { useEffect, useState } from 'react'
import io from 'socket.io-client'
import axios from 'axios'

import AdminPanel from '../shared/AdminPanel'
import CashierPanel from '../shared/CashierPanel'
import ClerkPanel from '../shared/ClerkPanel2'

const rawApi = import.meta.env.VITE_API_URL
let API = rawApi || 'http://localhost:4000'
try {
  if (API.startsWith(':')) {
    API = `${window.location.protocol}//${window.location.hostname}${API}`
  } else if (API.startsWith('localhost')) {
    API = `${window.location.protocol}//${API}`
  }
} catch (e) {}

export default function Dashboard({ user }) {
  const [socket, setSocket] = useState(null)
  const [items, setItems] = useState([])

  useEffect(() => {
    const s = io(API)
    setSocket(s)
    s.on('connect', () => console.log('connected', s.id))
    // identify this socket with the logged-in user so server can target messages
    s.on('connect', () => {
      try { s.emit('identify', { userId: user?.id }) } catch (e) { }
    })
    s.on('stock:update', data => {
      // simple refresh list
      fetchItems()
    })
    s.on('call:new', data => {
      console.log('call:new', data)
      // show a quick notification when a call arrives
      try { if (user && user.role_id !== 2) { /* only log for non-cashiers if desired */ } } catch(e){}
    })
    return () => s.disconnect()
  }, [])
  
  // ensure socket identifies itself when user becomes available
  useEffect(() => {
    if (!socket || !user) return
    try {
      socket.emit('identify', { userId: user.id, role: user.role_id })
      console.log('socket identify emitted for user', user.id)
    } catch (e) { console.error('identify emit failed', e) }
  }, [socket, user])

  useEffect(() => {
    fetchItems()
  }, [])

  async function fetchItems() {
    try {
      const token = localStorage.getItem('token')
      const res = await axios.get(API + '/api/items', { headers: { Authorization: `Bearer ${token}` } })
      setItems(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  if (!user) return <div className="p-8">Please <a href="/login" className="text-indigo-600">login</a>.</div>

  const role = user.role_id === 1 ? 'admin' : (user.role_id === 2 ? 'cashier' : 'clerk')

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Stock Management — {role.toUpperCase()}</h1>
        <div className="flex items-center gap-4">
          <div>{user.name}</div>
          <button className="text-sm text-red-600" onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = '/login' }}>Logout</button>
        </div>
      </header>

      <main>
        {role === 'admin' && <AdminPanel items={items} socket={socket} />}
        {role === 'cashier' && <CashierPanel items={items} socket={socket} />}
        {role === 'clerk' && <ClerkPanel socket={socket} />}
      </main>
    </div>
  )
}
