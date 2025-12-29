import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'

export default function App() {
  const [user, setUser] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userStr = localStorage.getItem('user')
    if (token && userStr) setUser(JSON.parse(userStr))
  }, [])

  return (
    <Routes>
      <Route path="/login" element={<Login onAuth={(u, t) => { setUser(u); localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }} />} />
      <Route path="/signup" element={<Signup onAuth={(u, t) => { setUser(u); localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }} />} />
      <Route path="/" element={user ? <Dashboard user={user} /> : <Navigate to="/login" replace />} />
    </Routes>
  )
}
