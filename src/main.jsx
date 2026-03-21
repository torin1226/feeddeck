import './migrations' // Must be first — renames pv-* → fd-* before stores init
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import AppShell from './components/AppShell'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AppShell />
  </BrowserRouter>
)
