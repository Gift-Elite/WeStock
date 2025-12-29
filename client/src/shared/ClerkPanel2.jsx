import React, { useState, useEffect } from 'react'
import axios from 'axios'

export default function ClerkPanel2({ socket }) {
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
  const [pendingRequests, setPendingRequests] = useState([])
  const [pendingCarts, setPendingCarts] = useState([])
  const [form, setForm] = useState({ sku: '', name: '', quantity: 0, box_quantity: 0, price_box: '', price_item: '' })
  const [image, setImage] = useState(null)
  const [req, setReq] = useState({ item_id: '', quantity: 1, unit_type: 'item', price: '' })
  const [incomingCall, setIncomingCall] = useState(null)
  const [myRequests, setMyRequests] = useState([])

  useEffect(() => { fetchItems() }, [])
  useEffect(() => { fetchPending(); }, [])
  useEffect(() => { fetchMine() }, [])

  useEffect(() => {
    if (!socket) return
    socket.on('stock:update', () => fetchItems())
    socket.on('stock:refresh', () => fetchItems())
    socket.on('purchase:new', () => fetchPending())
    socket.on('purchase:confirmed', () => fetchMine())
    socket.on('purchase:denied', () => fetchMine())
    socket.on('call:new', data => { setIncomingCall(data); fetchPending(); fetchItems() })
    socket.on('purchase:confirmed', data => { window.showMessage && window.showMessage('success', 'Your purchase request was approved'); fetchPending(); fetchItems(); fetchMine() })
    socket.on('purchase:denied', data => { window.showMessage && window.showMessage('error', 'Your purchase request was denied'); fetchPending(); fetchItems(); fetchMine() })
    socket.on('cart:new', () => fetchPending())
    return () => {
      socket.off('stock:update')
      socket.off('stock:refresh')
      socket.off('purchase:new')
      socket.off('call:new')
      socket.off('purchase:confirmed')
      socket.off('purchase:denied')
      socket.off('cart:new')
    }
  }, [socket])

  async function respondCall(response) {
    if (!incomingCall) return
    try {
      const token = localStorage.getItem('token')
      let clerkId = null
      if (token) {
        const parts = token.split('.')
        if (parts.length > 1) {
          try { clerkId = JSON.parse(atob(parts[1])).id } catch (e) { /* ignore */ }
        }
      }
      socket.emit('call:response', { callId: incomingCall.id, response, clerkId })
      setIncomingCall(null)
    } catch (e) { console.error(e) }
  }

  async function fetchItems() {
    try {
      const token = localStorage.getItem('token')
      const res = await axios.get((import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/items', { headers: { Authorization: `Bearer ${token}` } })
      setItems(res.data)
    } catch (err) { console.error(err) }
  }

  async function createItem(e) {
    e.preventDefault()
    try {
      const token = localStorage.getItem('token')
      const fd = new FormData()
      fd.append('sku', form.sku)
      fd.append('name', form.name)
      fd.append('quantity', form.quantity)
      fd.append('box_quantity', form.box_quantity)
      fd.append('price_box', form.price_box)
      fd.append('price_item', form.price_item)
      if (image) fd.append('image', image)
      await axios.post((import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/items', fd, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } })
      setForm({ sku: '', name: '', quantity: 0, box_quantity: 0, price_box: '', price_item: '' })
      setImage(null)
      fetchItems()
    } catch (err) { console.error(err); window.showMessage && window.showMessage('error', 'Failed to create item') }
  }

  async function sendRemoval(e) {
    e.preventDefault()
    try {
      const token = localStorage.getItem('token')
      const payload = { item_id: req.item_id, quantity: req.quantity, note: req.note }
      await axios.post((import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/purchases/request', payload, { headers: { Authorization: `Bearer ${token}` } })
      if (socket) {
        try {
          const tokParts = localStorage.getItem('token')?.split('.') || []
          const clerkId = tokParts.length > 1 ? JSON.parse(atob(tokParts[1])).id : null
          socket.emit('purchase:request', { ...payload, clerkId })
        } catch (e) { /* ignore socket emit error */ }
      }
      setReq({ item_id: '', quantity: 1, unit_type: 'item', note: '' })
      fetchItems()
      window.showMessage && window.showMessage('success', 'Request sent')
    } catch (err) { console.error(err); window.showMessage && window.showMessage('error', 'Failed to send request') }
  }

  async function fetchPending() {
    try {
      const token = localStorage.getItem('token')
      const pr = await axios.get((import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/purchases/pending', { headers: { Authorization: `Bearer ${token}` } })
      const carts = await axios.get((import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/carts/pending', { headers: { Authorization: `Bearer ${token}` } })
      setPendingRequests(pr.data || [])
      setPendingCarts(carts.data || [])
    } catch (e) { console.error(e) }
  }

  async function fetchMine() {
    try {
      const token = localStorage.getItem('token')
      const res = await axios.get((import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/purchases/mine', { headers: { Authorization: `Bearer ${token}` } })
      setMyRequests(res.data || [])
    } catch (e) { console.error(e) }
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-3">Clerk Panel</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="col-span-1 bg-white p-4 rounded shadow">
          <h3 className="font-medium mb-2">Remove From Stock</h3>
          <form onSubmit={sendRemoval} className="space-y-2">
            <select aria-label="Select item" placeholder="Select item" value={req.item_id} onChange={e => setReq({...req, item_id: e.target.value})} className="border p-2 w-full rounded">
              <option value="">Select item</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name} — {i.quantity} available</option>)}
            </select>
            <div className="flex gap-2">
              <input placeholder="Quantity" type="number" min="1" value={req.quantity} onChange={e => setReq({...req, quantity: e.target.value})} className="border p-2 w-1/2 rounded" />
              <select value={req.unit_type} onChange={e => setReq({...req, unit_type: e.target.value})} className="border p-2 w-1/2 rounded">
                <option value="item">Item</option>
                <option value="box">Box</option>
              </select>
            </div>
            <button type="submit" className="px-3 py-2 bg-yellow-500 rounded w-full">Send to Cashier</button>
          </form>
        </section>

        <section className="col-span-2 bg-white p-4 rounded shadow overflow-auto">
          <h3 className="font-medium mb-2">Current Stock</h3>
          <table className="w-full text-sm table-auto">
            <thead>
              <tr className="text-left"><th>Product</th><th>Total</th><th>Assigned</th><th>Remaining</th><th>Price</th></tr>
            </thead>
            <tbody>
              {items.map(i => {
                const assignedFromReq = pendingRequests.filter(r => r.item_id === i.id).reduce((s,r) => s + (r.quantity||0), 0)
                const assigned = assignedFromReq
                const remaining = (i.quantity || 0)
                const priceVal = i.price_item ?? i.price_box ?? i.price ?? null
                const priceText = priceVal ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(priceVal) : '-'
                return (
                  <tr key={i.id} className="border-t">
                    <td className="py-2">{i.name}</td>
                    <td className="py-2">{i.quantity}</td>
                    <td className="py-2">{assigned}</td>
                    <td className="py-2">{remaining}</td>
                    <td className="py-2">{priceText}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <section className="bg-white p-4 rounded shadow">
          <h3 className="font-medium mb-2">Customer Cart</h3>
          {getRoleIdFromToken() === 2 ? (
            <div className="text-sm text-slate-500">Only clerks can create customer carts.</div>
          ) : (
            <CartEditor items={items} onCreate={async cart => {
              await axios.post((import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/carts', cart, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
              window.showMessage && window.showMessage('success', 'Cart sent to cashier')
              fetchItems(); fetchPending()
            }} />
          )}
        </section>

        <section className="bg-white p-4 rounded shadow">
          <h3 className="font-medium mb-2">My Requests</h3>
          {myRequests.length === 0 && <div className="text-sm text-slate-500">No requests</div>}
          <ul className="space-y-2 mt-2">
            {myRequests.map(r => (
              <li key={r.id} className="p-2 border rounded flex items-start justify-between">
                <div>
                  <div className="font-medium">{r.item_name} x {r.quantity}</div>
                  <div className="text-xs text-slate-500">Status: {r.status} · Submitted: {new Date(r.created_at).toLocaleString()}</div>
                </div>
                <div className="text-sm text-slate-500">{r.status === 'confirmed' ? 'Approved' : (r.status === 'paid' ? 'Paid' : r.status)}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
        {incomingCall && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
            <div className="bg-white p-4 rounded shadow w-96">
              <h4 className="font-semibold mb-2">Incoming Call</h4>
              <div className="mb-3">Cashier is calling{incomingCall && incomingCall.cashier_name ? `: ${incomingCall.cashier_name}` : ''}</div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => respondCall('have_customer')} className="px-3 py-1 bg-yellow-500 rounded">Have Customer</button>
                <button onClick={() => respondCall('answered')} className="px-3 py-1 bg-green-600 text-white rounded">Answer</button>
              </div>
            </div>
          </div>
        )}

    </div>
  )
}

  function CartEditor({ items, onCreate }) {
  const [customer, setCustomer] = useState('')
  const [cartItems, setCartItems] = useState([])
  const [selected, setSelected] = useState('')
  const [qty, setQty] = useState(1)

  function addItem() {
    if (!selected) return window.showMessage && window.showMessage('error', 'Select item')
    const it = items.find(i=>i.id==selected)
    setCartItems([...cartItems, { item_id: it.id, quantity: Number(qty), price: it.price_item || it.price_box || 0 }])
    setSelected('')
    setQty(1)
  }

  function removeAt(idx) { setCartItems(cartItems.filter((_,i)=>i!==idx)) }

  const total = cartItems.reduce((s,i)=>s + (i.price||0)*i.quantity, 0)

  async function doCreate() {
    if (!onCreate) return
    await onCreate({ customer_name: customer, items: cartItems })
    // clear local cart and mark sent
    setCartItems([])
    setCustomer('')
  }

  return (
    <div>
      <input placeholder="Customer name" value={customer} onChange={e=>setCustomer(e.target.value)} className="border p-1 w-full mb-2" />
      <div className="flex gap-2 mb-2">
        <select value={selected} onChange={e=>setSelected(e.target.value)} className="border p-1 flex-1">
          <option value="">Select product</option>
          {items.map(i=> <option key={i.id} value={i.id}>{i.name} — {i.quantity}</option>)}
        </select>
        <input type="number" min="1" value={qty} onChange={e=>setQty(e.target.value)} className="border p-1 w-24" />
        <button type="button" onClick={addItem} className="px-3 py-1 bg-gray-200">Add</button>
      </div>
      <ul className="mb-2">
        {cartItems.map((ci, idx) => (<li key={idx} className="flex justify-between"><span>{items.find(i=>i.id==ci.item_id)?.name} x {ci.quantity}</span><button onClick={()=>removeAt(idx)} className="text-red-600">Remove</button></li>))}
      </ul>
      <div className="mb-2">Total: {total.toFixed(2)}</div>
      <button onClick={doCreate} className="px-3 py-1 bg-green-600 text-white">Send to Cashier</button>
    </div>
  )
}
