import React, { useEffect, useState } from 'react'
import Icon from './Icon'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000'

export default function AdminPanel() {
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

  const [users, setUsers] = useState([])
  const [pending, setPending] = useState([])
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [items, setItems] = useState([])
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState(0)
  const [boxQuantity, setBoxQuantity] = useState(0)
  const [priceItem, setPriceItem] = useState('')
  const [priceBox, setPriceBox] = useState('')
  const [image, setImage] = useState(null)
  const [reportModal, setReportModal] = useState(false)
  const [reportData, setReportData] = useState(null)
  const [reportDate, setReportDate] = useState('')
  const [broadcastText, setBroadcastText] = useState('')
  const [priceModal, setPriceModal] = useState({ open: false, itemId: null, type: null, value: '' })

  useEffect(() => { fetchUsers(); fetchItems(); fetchPending() }, [])

  async function fetchUsers() {
    const token = localStorage.getItem('token')
    const res = await axios.get(API + '/api/admin/users', { headers: { Authorization: `Bearer ${token}` } })
    setUsers(res.data)
  }

  async function fetchItems() {
    const token = localStorage.getItem('token')
    const res = await axios.get(API + '/api/items', { headers: { Authorization: `Bearer ${token}` } })
    setItems(res.data)
  }

  async function fetchPending() {
    const token = localStorage.getItem('token')
    const res = await axios.get(API + '/api/admin/approvals', { headers: { Authorization: `Bearer ${token}` } })
    setPending(res.data || [])
  }

  async function fetchReport(date) {
    const token = localStorage.getItem('token')
    const url = API + '/api/admin/reports/daily' + (date ? '?date=' + date : '')
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } })
    return res.data
  }

  async function sendBroadcast() {
    if (!broadcastText) return
    const token = localStorage.getItem('token')
    await axios.post(API + '/api/messages', { message: broadcastText }, { headers: { Authorization: `Bearer ${token}` } })
    setBroadcastText('')
  }

  async function submitPrice() {
    const { itemId, type, value } = priceModal
    const token = localStorage.getItem('token')
    await axios.post(
      API + '/api/admin/items/' + itemId + '/price',
      { price_type: type, price: value },
      { headers: { Authorization: `Bearer ${token}` } }
    )
    setPriceModal({ open: false, itemId: null, type: null, value: '' })
    fetchItems()
  }

  async function createItem(e) {
    e.preventDefault()
    const token = localStorage.getItem('token')
    const fd = new FormData()
    fd.append('sku', sku)
    fd.append('name', name)
    fd.append('quantity', quantity)
    fd.append('box_quantity', boxQuantity)
    if (priceItem) fd.append('price_item', priceItem)
    if (priceBox) fd.append('price_box', priceBox)
    if (image) fd.append('image', image)

    await axios.post(API + '/api/items', fd, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
    })

    setSku(''); setName(''); setQuantity(0); setBoxQuantity(0); setPriceItem(''); setPriceBox(''); setImage(null)
    fetchItems()
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex items-center gap-3 bg-white p-4 rounded-xl shadow">
          <Icon name="admin" />
          <h1 className="text-xl font-bold">🛠 Admin Panel</h1>
        </div>

        {/* MAIN GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ITEMS */}
          <section className="lg:col-span-2 bg-white p-4 rounded-xl shadow overflow-x-auto">
            <h2 className="font-semibold mb-3">📦 Items</h2>
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-slate-100">
                <tr className="text-left">
                  <th className="p-2">Name</th>
                  <th className="p-2">Qty</th>
                  <th className="p-2">Item Price</th>
                  <th className="p-2">Box Price</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(i => (
                  <tr key={i.id} className="border-t hover:bg-slate-50">
                    <td className="p-2">{i.name}</td>
                    <td className="p-2">{i.quantity} ({i.box_quantity})</td>
                    <td className="p-2">{i.price_item ?? '-'}</td>
                    <td className="p-2">{i.price_box ?? '-'}</td>
                    <td className="p-2">{i.status}</td>
                    <td className="p-2 text-right space-x-2">
                      <button className="px-3 py-1 rounded-full border" onClick={() => setPriceModal({ open: true, itemId: i.id, type: 'item', value: '' })}>
                        Item
                      </button>
                      <button className="px-3 py-1 rounded-full border" onClick={() => setPriceModal({ open: true, itemId: i.id, type: 'box', value: '' })}>
                        Box
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* RIGHT COLUMN */}
          <aside className="bg-white p-4 rounded-xl shadow space-y-6">

            {/* BROADCAST */}
            <div>
              <h3 className="font-semibold mb-2">📢 Broadcast</h3>
              <textarea
                value={broadcastText}
                onChange={e => setBroadcastText(e.target.value)}
                className="w-full border rounded-lg p-2"
                rows={3}
              />
              <button onClick={sendBroadcast} className="mt-2 w-full bg-indigo-600 text-white py-2 rounded-full">
                Send
              </button>
            </div>

            {/* ADD PRODUCT */}
            <div>
              <h3 className="font-semibold mb-2">➕ Add Product</h3>
              {getRoleIdFromToken() === 1 ? (
                <form onSubmit={createItem} className="space-y-2">
                  <input className="w-full border rounded p-1" placeholder="SKU" value={sku} onChange={e => setSku(e.target.value)} />
                  <input className="w-full border rounded p-1" placeholder="Name" value={name} onChange={e => setName(e.target.value)} required />
                  <input className="w-full border rounded p-1" type="number" placeholder="Quantity" value={quantity} onChange={e => setQuantity(Number(e.target.value))} />
                  <input className="w-full border rounded p-1" type="number" placeholder="Box quantity" value={boxQuantity} onChange={e => setBoxQuantity(Number(e.target.value))} />
                  <input className="w-full border rounded p-1" placeholder="Price (item)" value={priceItem} onChange={e => setPriceItem(e.target.value)} />
                  <input className="w-full border rounded p-1" placeholder="Price (box)" value={priceBox} onChange={e => setPriceBox(e.target.value)} />
                  <input type="file" onChange={e => setImage(e.target.files[0])} />
                  <button className="w-full bg-green-600 text-white py-2 rounded-full">
                    Create
                  </button>
                </form>
              ) : (
                <p className="text-sm text-slate-500">Admins only</p>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* PRICE MODAL */}
      {priceModal.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded-xl w-96 max-w-full">
            <h3 className="font-semibold mb-3">Set {priceModal.type} price</h3>
            <input
              className="w-full border rounded p-2 mb-3"
              type="number"
              value={priceModal.value}
              onChange={e => setPriceModal({ ...priceModal, value: e.target.value })}
            />
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1 rounded border" onClick={() => setPriceModal({ open: false })}>Cancel</button>
              <button className="px-3 py-1 rounded bg-indigo-600 text-white" onClick={submitPrice}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
