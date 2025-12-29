import React, { useEffect, useState } from 'react'
import MessageSender from './MessageSender'
import axios from 'axios'

export default function ClerkPanel({ socket }) {
  function getRoleIdFromToken() {
    try {
      const token = localStorage.getItem('token')
      if (!token) return null
      const parts = token.split('.')
      if (parts.length < 2) return null
      const payload = JSON.parse(atob(parts[1]))
      return payload.role_id || null
    } catch (e) { return null }
  }
  const [items, setItems] = useState([])
  const [image, setImage] = useState(null)
  const [incomingCall, setIncomingCall] = useState(null)

  const [form, setForm] = useState({
    sku: '',
    name: '',
    quantity: 0,
    box_quantity: 0,
    price_box: '',
    price_item: ''
  })

  const [req, setReq] = useState({
    item_id: '',
    quantity: 1,
    unit_type: 'item',
    price: ''
  })

  /* ================= FETCH ITEMS ================= */
  async function fetchItems() {
    try {
      const token = localStorage.getItem('token')
      const res = await axios.get(
        (import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/items',
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setItems(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    fetchItems()
  }, [])

  /* ================= SOCKET EVENTS ================= */
  useEffect(() => {
    if (!socket) return

    socket.on('purchase:confirmed', () => {
      window.showMessage?.('success', 'Purchase approved')
      fetchItems()
    })

    socket.on('purchase:denied', () => {
      window.showMessage?.('error', 'Purchase denied')
      fetchItems()
    })

    socket.on('cart:cancelled', () => {
      window.showMessage?.('info', 'Cart cancelled')
      fetchItems()
    })

    socket.on('call:new', data => {
      setIncomingCall(data)
    })

    return () => {
      socket.off('purchase:confirmed')
      socket.off('purchase:denied')
      socket.off('cart:cancelled')
      socket.off('call:new')
    }
  }, [socket])

  /* ================= CREATE ITEM ================= */
  async function createItem(e) {
    e.preventDefault()
    try {
      const token = localStorage.getItem('token')
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      if (image) fd.append('image', image)

      await axios.post(
        (import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/items',
        fd,
        { headers: { Authorization: `Bearer ${token}` } }
      )

      setForm({
        sku: '',
        name: '',
        quantity: 0,
        box_quantity: 0,
        price_box: '',
        price_item: ''
      })
      setImage(null)
      fetchItems()
      window.showMessage?.('success', 'Item created')
    } catch {
      window.showMessage?.('error', 'Failed to create item')
    }
  }

  /* ================= SEND TO CASHIER ================= */
  async function sendRemoval(e) {
    e.preventDefault()
    try {
      const token = localStorage.getItem('token')
      await axios.post(
        (import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/purchases/request',
        req,
        { headers: { Authorization: `Bearer ${token}` } }
      )

      try {
        const clerkId = JSON.parse(atob(token.split('.')[1])).id
        socket?.emit('purchase:request', { ...req, clerkId })
      } catch {}

      setReq({ item_id: '', quantity: 1, unit_type: 'item', price: '' })
      fetchItems()
      window.showMessage?.('success', 'Request sent')
    } catch {
      window.showMessage?.('error', 'Failed to send request')
    }
  }

  /* ================= CALL RESPONSE ================= */
  function respondCall(response) {
    try {
      const token = localStorage.getItem('token')
      const clerkId = JSON.parse(atob(token.split('.')[1])).id
      socket.emit('call:response', {
        callId: incomingCall.id,
        response,
        clerkId
      })
      setIncomingCall(null)
    } catch (e) {
      console.error(e)
    }
  }

  /* ================= UI ================= */
  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <h1 className="text-2xl font-semibold mb-6">Clerk Dashboard</h1>
        <div className="mb-4 flex items-center gap-2">
          <Icon name="clerk" />
          <h2 className="text-lg font-semibold">Clerk Dashboard</h2>
        </div>
        <div className="mb-4">
          <label className="block text-sm mb-1">Send message to users</label>
          <MessageSender roleLabel="clerk" />
        </div>
      <div className="grid lg:grid-cols-2 gap-6">
        {/* ADD ITEM (admin only) */}
        <section className="bg-white rounded-2xl shadow-sm border p-6">
          <h2 className="text-lg font-medium mb-4">Add Product</h2>
          {getRoleIdFromToken() === 1 ? (
            <form onSubmit={createItem} className="space-y-3">
              <input className="input" placeholder="SKU"
                value={form.sku}
                onChange={e => setForm({ ...form, sku: e.target.value })} />

              <input className="input" placeholder="Product name"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} />

              <div className="grid grid-cols-3 gap-3">
                <input type="number" className="input" placeholder="Quantity"
                  value={form.quantity}
                  onChange={e => setForm({ ...form, quantity: e.target.value })} />

                <input type="number" className="input" placeholder="Box qty"
                  value={form.box_quantity}
                  onChange={e => setForm({ ...form, box_quantity: e.target.value })} />

                <input className="input" placeholder="Price / box"
                  value={form.price_box}
                  onChange={e => setForm({ ...form, price_box: e.target.value })} />
              </div>

              <input className="input" placeholder="Price / item"
                value={form.price_item}
                onChange={e => setForm({ ...form, price_item: e.target.value })} />

              <input type="file" onChange={e => setImage(e.target.files[0])} />

              <button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-xl">
                Create Product
              </button>
            </form>
          ) : (
            <div className="text-sm text-slate-500">Only admins can add products.</div>
          )}
        </section>

        {/* SEND TO CASHIER (clerks and admins only) */}
        <section className="bg-white rounded-2xl shadow-sm border p-6">
          <h2 className="text-lg font-medium mb-4">Send Items to Cashier</h2>
          {(getRoleIdFromToken() === 3 || getRoleIdFromToken() === 1) ? (
            <form onSubmit={sendRemoval} className="space-y-3">
              <select className="input"
                value={req.item_id}
                onChange={e => setReq({ ...req, item_id: e.target.value })}>
                <option value="">Select item</option>
                {items.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.name} — {i.quantity} available
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-3">
                <input type="number" min="1" className="input"
                  value={req.quantity}
                  onChange={e => setReq({ ...req, quantity: e.target.value })} />

                <select className="input"
                  value={req.unit_type}
                  onChange={e => setReq({ ...req, unit_type: e.target.value })}>
                  <option value="item">Item</option>
                  <option value="box">Box</option>
                </select>
              </div>

              <button className="w-full bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-xl">
                Send to Cashier
              </button>
            </form>
          ) : (
            <div className="text-sm text-slate-500">Only clerks can send items to cashier.</div>
          )}
        </section>
      </div>

      {/* INCOMING CALL MODAL */}
      {incomingCall && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-96 shadow-lg">
            <h3 className="text-lg font-semibold mb-2">Incoming Call</h3>
            <p className="text-slate-600 mb-4">
              Cashier is calling
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => respondCall('have_customer')}
                className="px-4 py-2 bg-amber-500 text-white rounded-lg">
                Have Customer
              </button>
              <button
                onClick={() => respondCall('answered')}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg">
                Answer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INPUT STYLE */}
      <style>{`
        .input {
          width: 100%;
          padding: 0.55rem 0.75rem;
          border-radius: 0.75rem;
          border: 1px solid #e5e7eb;
          outline: none;
        }
        .input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 1px #6366f1;
        }
      `}</style>
    </div>
  )
}
