import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'
import ToastContainer from './shared/Toast'
import MessageCenter from './shared/MessageCenter'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
    <ToastContainer />
    <MessageCenter />
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
