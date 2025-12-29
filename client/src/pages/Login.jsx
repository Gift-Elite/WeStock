import React, { useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'

export default function Login({ onAuth }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const nav = useNavigate()

  const submit = async e => {
    e.preventDefault()
    try {
      const res = await axios.post((import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/login', { email, password })
      onAuth(res.data.user, res.data.token)
      nav('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form onSubmit={submit} className="bg-white p-8 rounded shadow w-full max-w-md">
        <h2 className="text-2xl font-semibold mb-6">Sign in</h2>
        {error && <div className="text-red-600 mb-4">{error}</div>}
        <label className="block mb-2">Email</label>
        <input value={email} onChange={e => setEmail(e.target.value)} className="w-full p-2 border rounded mb-4" />
        <label className="block mb-2">Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-2 border rounded mb-6" />
        <button className="w-full bg-indigo-600 text-white py-2 rounded">Login</button>
        <div className="mt-4 text-center">
          <a href="/signup" className="text-sm text-indigo-600">Create an account</a>
        </div>
      </form>
    </div>
  )
}
