import React, { useState, useEffect } from 'react'
import axios from 'axios'
import Icon from './Icon'
import MessageSender from './MessageSender'

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000'

export default function CashierPanel({ items, socket }) {
  const [calling, setCalling] = useState(null) // { id, clerk_id, status, message }
  const [cart, setCart] = useState([])
  const [pending, setPending] = useState([])
  const [pendingCarts, setPendingCarts] = useState([])
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentTarget, setPaymentTarget] = useState(null) // { type:'request'|'cart', id }

  // Note: Adding items to cart from cashier UI is intentionally removed.
  // Cashier view will show stock remaining instead of directly adding to cart.

  async function checkout(payment_method) {
    const token = localStorage.getItem('token')
    const res = await axios.post(API + '/api/sales', { items: cart, total: cart.reduce((s, c) => s + c.price * c.quantity, 0), payment_method }, { headers: { Authorization: `Bearer ${token}` } })
    window.showMessage && window.showMessage('success', 'Sale recorded: ' + res.data.saleId)
    setCart([])
  }

  function callClerk() {
    // emit a call to any clerk (demo: clerk id 3)
    const fromId = JSON.parse(localStorage.getItem('user')).id
    console.log('Cashier emitting call:clerk -> clerkId=3 from=', fromId)
    // show local calling modal immediately
    setCalling({ status: 'calling', clerkId: 3 })
    socket?.emit('call:clerk', { clerkId: 3, fromCashierId: fromId })
  }

  useEffect(() => {
    if (!socket) return
    socket.on('call:created', data => {
      console.log('call created', data)
      setCalling({ id: data.id, status: 'calling', clerkId: data.clerk_id })
    })
    socket.on('call:response', data => {
      console.log('call response', data)
      setCalling(prev => ({ ...prev, status: data.response, message: data.message }))
      // hide after short delay
      setTimeout(() => setCalling(null), 2000)
    })
    return () => {
      socket.off('call:created')
      socket.off('call:response')
    }
  }, [socket])

  useEffect(() => {
    fetchPending()
    fetchCarts()
    if (!socket) return
    socket.on('connect', () => console.log('Cashier socket connected', socket.id))
    socket.on('purchase:new', data => { console.log('Cashier received purchase:new', data); fetchPending(); fetchCarts() })
    socket.on('purchase:confirmed', data => { fetchPending(); fetchCarts() })
    socket.on('cart:new', () => fetchCarts())
    socket.on('cart:confirmed', () => fetchCarts())
    socket.on('cart:paid', () => fetchCarts())
    return () => {
      socket?.off('purchase:new')
      socket?.off('purchase:confirmed')
      socket?.off('cart:new')
      socket?.off('cart:confirmed')
      socket?.off('cart:paid')
    }
  }, [socket])

  async function fetchPending() {
    try {
      const token = localStorage.getItem('token')
      const res = await axios.get(API + '/api/purchases/pending', { headers: { Authorization: `Bearer ${token}` } })
      setPending(res.data)
    } catch (err) { console.error(err) }
  }

  async function fetchCarts() {
    try {
      const token = localStorage.getItem('token')
      const res = await axios.get(API + '/api/carts/pending', { headers: { Authorization: `Bearer ${token}` } })
      setPendingCarts(res.data)
    } catch (err) { console.error(err) }
  }

  async function confirmRequest(id) {
    const token = localStorage.getItem('token')
    await axios.post(API + '/api/purchases/confirm', { request_id: id }, { headers: { Authorization: `Bearer ${token}` } })
    window.showMessage && window.showMessage('success', 'Purchase confirmed and stock updated')
    fetchPending()
  }

  async function markPaid(id) {
    setPaymentTarget({ type: 'request', id })
    setShowPaymentModal(true)
  }

  async function confirmCart(id) {
    const token = localStorage.getItem('token')
    await axios.post(API + `/api/carts/${id}/confirm`, {}, { headers: { Authorization: `Bearer ${token}` } })
    window.showMessage && window.showMessage('success', 'Cart confirmed')
    fetchCarts()
  }

  async function cancelCart(id) {
    const token = localStorage.getItem('token')
    try {
      await axios.post(API + `/api/carts/${id}/cancel`, {}, { headers: { Authorization: `Bearer ${token}` } })
      window.showMessage && window.showMessage('success', 'Cart cancelled and stock restored')
      fetchCarts(); fetchPending();
    } catch (e) { console.error(e); window.showMessage && window.showMessage('error', 'Failed to cancel cart') }
  }

  async function payCart(id) {
    setPaymentTarget({ type: 'cart', id })
    setShowPaymentModal(true)
  }

  async function doPayment(method) {
    if (!paymentTarget) return
    const token = localStorage.getItem('token')
    try {
      if (paymentTarget.type === 'request') {
        await axios.post(API + '/api/purchases/mark-paid', { request_id: paymentTarget.id, payment_method: method }, { headers: { Authorization: `Bearer ${token}` } })
        fetchPending()
      } else if (paymentTarget.type === 'cart') {
        await axios.post(API + `/api/carts/${paymentTarget.id}/pay`, { payment_method: method }, { headers: { Authorization: `Bearer ${token}` } })
        fetchCarts()
      }
      window.showMessage && window.showMessage('success', 'Payment processed (' + method + ')')
    } catch (e) { console.error(e); window.showMessage && window.showMessage('error', 'Payment failed') }
    setShowPaymentModal(false)
    setPaymentTarget(null)
  }

  function PaymentModal() {
    if (!showPaymentModal) return null
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
        <div className="bg-white p-4 rounded w-80">
          <h2 className="font-semibold mb-2">Select payment method</h2>
          <div className="flex flex-col gap-2">
            <button className="px-3 py-2 bg-green-600 text-white rounded-full" onClick={() => doPayment('💵 cash')}>Cash</button>
            <button className="px-3 py-2 bg-blue-600 text-white rounded-full" onClick={() => doPayment('💳 card')}>Card</button>
            <button className="px-3 py-2 bg-purple-600 text-white rounded-full transition-all duration-100 ease-in disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed data-[shape=pill]:rounded-full data-[width=full]:w-full focus:shadow-none hover:shadow-md border-yellow-600 hover:bg-yellow-500 hover:border-yellow-600" onClick={() => doPayment('MOMO')}>Mobile Money</button>
            <button className="px-3 py-2 border rounded-2xl hover:bg-red-500 focus:ring-4 focus:ring-red-300" onClick={() => { setShowPaymentModal(false); setPaymentTarget(null) }}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* single message sender kept below header (duplicate removed) */}
      <div className="mb-4 flex items-center gap-2">
        <Icon name="cashier" />
        <h2 className="text-lg font-semibold">Cashier Panel</h2>
      </div>
      <div className="mb-4">
        <label className="block text-sm mb-1">Send message to users</label>
        <MessageSender roleLabel="cashier" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <section className="md:col-span-2 bg-white p-4 rounded shadow">
        <h2 className="font-semibold mb-3">Items</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(i => {
            const priceVal = i.price_item ?? i.price_box ?? i.price ?? null
            const priceText = priceVal ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(priceVal) : '—'
            return (
              <div key={i.id} className="p-3 border rounded">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{i.name}</div>
                  <div className="text-sm bg-indigo-50 text-indigo-700 px-2 py-1 rounded">{priceText}</div>
                </div>
                <div className="text-sm text-slate-500">Stock remaining: <span className="font-semibold">{i.quantity}</span></div>
                <div className="mt-2">
                  <div className="text-xs text-slate-400">Items cannot be added from this view.</div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <aside className="bg-white p-4 rounded shadow md:col-span-1">
        <h2 className="font-semibold mb-3">AVAILABLE CLERK</h2>
        <ul>
          {cart.map(c => <li key={c.id} className="mb-2">{c.name} x {c.quantity}</li>)}
        </ul>
        {/* <div className="mt-4">
          <button className="mr-2 px-3 py-1 bg-green-600 text-white rounded" onClick={() => checkout('cash')}>Pay Cash</button>
          <button className="mr-2 px-3 py-1 bg-blue-600 text-white rounded" onClick={() => checkout('card')}>Pay Card</button>
          <button className="px-3 py-1 bg-purple-600 text-white rounded" onClick={() => checkout('mobile')}>Pay Mobile</button>
        </div> */}
        <div className="mt-4">
          <button className="w-full py-2 rounded-full bg-yellow-500 text-white font-semibold hover:bg-yellow-600" onClick={callClerk}>📞 Call Clerk</button>
        </div>
        <div className="mt-6">
          <h3 className="font-semibold mb-2">Clerk Requests</h3>
          {pending.length === 0 && <div className="text-sm text-slate-500">No pending requests</div>}
          <ul className="space-y-2 mt-2">
            {pending.map(req => {
              let parsedNote = null;
              try { parsedNote = req.note ? JSON.parse(req.note) : null } catch (e) { parsedNote = null }
              const customerName = parsedNote && (parsedNote.customer_name || parsedNote.customer) ? (parsedNote.customer_name || parsedNote.customer) : null
              const displayNote = parsedNote && parsedNote.note ? parsedNote.note : null
              return (
                <li key={req.id} className="p-2 border rounded flex items-start justify-between">
                  <div>
                    <div className="font-medium">{req.item_name} x {req.quantity}</div>
                    <div className="text-xs text-slate-500">
                      Requested by {req.clerk_name} — {req.status}
                      {customerName && <span> · Customer: {customerName}</span>}
                    </div>
                    {displayNote && <div className="text-xs text-slate-400">Note: {displayNote}</div>}
                  </div>
                  <div className="flex flex-col gap-2">
                    {req.status === 'pending' && <>
                      <button className="px-2 py-1 bg-indigo-600 text-white rounded text-sm" onClick={() => confirmRequest(req.id)}>Approve</button>
                      <button className="px-2 py-1 bg-red-600 text-white rounded text-sm" onClick={async () => {
                        const token = localStorage.getItem('token')
                        try {
                          await axios.post(API + '/api/purchases/deny', { request_id: req.id }, { headers: { Authorization: `Bearer ${token}` } })
                          fetchPending(); fetchCarts();
                        } catch (e) { console.error(e); window.showMessage && window.showMessage('error', 'Failed to deny') }
                      }}>Deny</button>
                    </>}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="mt-6">
          <h3 className="font-semibold mb-2">Pending Customer Carts</h3>
          {pendingCarts.length === 0 && <div className="text-sm text-slate-500">No pending carts</div>}
          <ul className="space-y-2 mt-2">
            {pendingCarts.map(c => (
              <li key={c.id} className="p-2 border rounded flex items-start justify-between">
                <div>
                  <div className="font-medium">{c.customer_name || 'Walk-in'} — {c.total}</div>
                  <div className="text-xs text-slate-500">Submitted by {c.clerk_name} · {c.status}</div>
                </div>
                <div className="flex flex-col gap-2">
                  {c.status === 'sent' && <button className="px-2 py-1 bg-indigo-600 text-white rounded text-sm" onClick={() => confirmCart(c.id)}>Confirm</button>}
                  {(c.status === 'sent' || c.status === 'confirmed') && <button className="px-2 py-1 bg-green-600 text-white rounded text-sm" onClick={() => payCart(c.id)}>Mark Paid</button>}
                  {(c.status === 'sent' || c.status === 'confirmed') && <button className="px-2 py-1 bg-red-600 text-white rounded text-sm" onClick={() => cancelCart(c.id)}>Cancel</button>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
      </div>
      {showPaymentModal && <PaymentModal />}
      {calling && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="bg-white p-4 rounded w-96 text-center">
            {calling.message ? (
              <div className="font-semibold mb-2">{calling.message.charAt(0).toUpperCase() + calling.message.slice(1)}</div>
            ) : (
              <>
                {calling.status === 'calling' && <>
                  <div className="font-semibold mb-2">Calling clerk...</div>
                  <div className="text-sm text-slate-500 mb-4">Waiting for response</div>
                </>}
                {calling.status === 'answered' && <div className="font-semibold text-green-600">Clerk answered</div>}
                {calling.status === 'have_customer' && <div className="font-semibold text-orange-600">Clerk: customer</div>}
              </>
            )}
            <div className="mt-4"><button className="px-3 py-1 border rounded hover:bg-red-500 focus:ring-4 focus:ring-red-300" onClick={() => setCalling(null)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  )
}
