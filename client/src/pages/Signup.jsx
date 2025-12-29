import React, { useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'

export default function Signup({ onAuth }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('cashier')
  const nav = useNavigate()

  const submit = async e => {
    e.preventDefault()
    try {
      const res = await axios.post((import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/signup', { name, email, password, role })
      onAuth(res.data.user, res.data.token)
      nav('/')
    } catch (err) {
        window.showMessage && window.showMessage('error', err.response?.data?.error || 'Signup failed')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form onSubmit={submit} className="bg-white p-8 rounded shadow w-full max-w-md">
        <h2 className="text-2xl font-semibold mb-6">Sign up</h2>
        <label className="block mb-2">Name</label>
        <input value={name} onChange={e => setName(e.target.value)} className="w-full p-2 border rounded mb-4" />
        <label className="block mb-2">Email</label>
        <input value={email} onChange={e => setEmail(e.target.value)} className="w-full p-2 border rounded mb-4" />
        <label className="block mb-2">Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-2 border rounded mb-4" />
        <label className="block mb-2">Role</label>
        <select value={role} onChange={e => setRole(e.target.value)} className="w-full p-2 border rounded mb-6">
          <option value="cashier">Cashier</option>
          <option value="clerk">Stock Clerk</option>
          <option value="admin">Admin</option>
        </select>
        <button className="w-full bg-indigo-600 text-white py-2 rounded">Create account</button>
      </form>
    </div>
  )
}
